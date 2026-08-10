/**
 * Reading the graph as work.
 *
 * The grouping and the dependency resolution are pure functions over a
 * snapshot, so they are pinned down here rather than judged by looking at the
 * board — which lane a blocked, overdue plan lands in is exactly the kind of
 * thing that is easy to get wrong and hard to see.
 */

import { expect, test } from "@playwright/test";

import { buildRoadmap, relativeDate } from "../lib/roadmap";
import type { GraphEdge, GraphNode } from "../lib/types";

function node(
  id: string,
  status: GraphNode["status"] = null,
  target: string | null = null,
): GraphNode {
  return {
    id,
    type: "plan",
    title: id,
    summary: "",
    thumbnail_url: null,
    tags: [],
    status,
    target_date: target,
  };
}

function edge(
  source: string,
  target: string,
  relation: GraphEdge["relation_type"],
): GraphEdge {
  return { id: `${source}-${target}`, source, target, relation_type: relation, weight: 1 };
}

const TODAY = "2026-08-07";

test.describe("roadmap grouping", () => {
  test("only memories with a status are work", () => {
    const roadmap = buildRoadmap(
      [node("a", "todo"), node("b"), node("c", "done")],
      [],
      TODAY,
    );

    expect(roadmap.total).toBe(2);
    expect(roadmap.lanes.todo.map((i) => i.node.id)).toEqual(["a"]);
    expect(roadmap.lanes.done.map((i) => i.node.id)).toEqual(["c"]);
  });

  test("dated work sorts before undated, soonest first", () => {
    const roadmap = buildRoadmap(
      [
        node("someday", "todo"),
        node("later", "todo", "2026-12-01"),
        node("sooner", "todo", "2026-09-01"),
      ],
      [],
      TODAY,
    );

    expect(roadmap.lanes.todo.map((i) => i.node.id)).toEqual([
      "sooner",
      "later",
      "someday",
    ]);
  });

  test("one direction carries the whole constraint", () => {
    // What used to need two relations needs one. `blocks` was `depends_on`
    // with the ends swapped, so the bug that holds up the release is now the
    // release depending on the bug, and the board reads both sides off it.
    const roadmap = buildRoadmap(
      [node("release", "todo"), node("feature", "doing"), node("bug", "todo")],
      [
        edge("release", "feature", "depends_on"),
        edge("release", "bug", "depends_on"),
      ],
      TODAY,
    );

    expect(roadmap.byId.get("release")?.blockedBy.sort()).toEqual([
      "bug",
      "feature",
    ]);
    expect(roadmap.byId.get("feature")?.blocking).toEqual(["release"]);
    expect(roadmap.byId.get("bug")?.blocking).toEqual(["release"]);
  });

  test("relates_to is not a sequencing constraint", () => {
    const roadmap = buildRoadmap(
      [node("a", "todo"), node("b", "todo")],
      [edge("a", "b", "relates_to")],
      TODAY,
    );

    expect(roadmap.byId.get("a")?.blockedBy).toEqual([]);
    expect(roadmap.byId.get("b")?.blocking).toEqual([]);
  });

  test("a dependency on something that is not work is not a blocker", () => {
    // Plans depend on decisions and people all the time; none of that is
    // sequencing, and a roadmap claiming otherwise would never look clear.
    const roadmap = buildRoadmap(
      [node("plan", "todo"), node("decision")],
      [edge("plan", "decision", "depends_on")],
      TODAY,
    );

    expect(roadmap.byId.get("plan")?.blockedBy).toEqual([]);
  });

  test("late work is flagged, but finished work is never late", () => {
    const roadmap = buildRoadmap(
      [
        node("late", "todo", "2026-07-01"),
        node("shipped", "done", "2026-07-01"),
        node("abandoned", "dropped", "2026-07-01"),
        node("upcoming", "todo", "2026-09-01"),
      ],
      [],
      TODAY,
    );

    expect(roadmap.byId.get("late")?.overdue).toBe(true);
    expect(roadmap.byId.get("shipped")?.overdue).toBe(false);
    expect(roadmap.byId.get("abandoned")?.overdue).toBe(false);
    expect(roadmap.byId.get("upcoming")?.overdue).toBe(false);
  });

  test("work due today is not yet late", () => {
    const roadmap = buildRoadmap([node("due", "todo", TODAY)], [], TODAY);
    expect(roadmap.byId.get("due")?.overdue).toBe(false);
  });
});

test.describe("relative dates", () => {
  const today = new Date("2026-08-07T12:00:00Z");

  test("reads as a person would say it", () => {
    expect(relativeDate("2026-08-07", today)).toBe("today");
    expect(relativeDate("2026-08-08", today)).toBe("tomorrow");
    expect(relativeDate("2026-08-06", today)).toBe("yesterday");
    expect(relativeDate("2026-08-10", today)).toBe("in 3 days");
    expect(relativeDate("2026-08-28", today)).toBe("in 3 weeks");
    expect(relativeDate("2026-07-01", today)).toBe("5 weeks ago");
    expect(relativeDate("2026-12-01", today)).toBe("in 4 months");
  });
});

test.describe("the roadmap page", () => {
  test("shows the work in the graph, and opens a memory from it", async ({
    page,
  }) => {
    await page.goto("/roadmap");

    const count = page.getByTestId("memory-count");
    await expect(count).toBeVisible();
    expect(Number(await count.textContent())).toBeGreaterThan(0);

    // Every lane is present whether or not it holds anything, so the board
    // has the same shape however the work is distributed.
    for (const lane of ["Planned", "In flight", "Done", "Dropped"]) {
      await expect(page.getByRole("heading", { name: lane })).toBeVisible();
    }

    // A card opens the same drawer the canvas uses — the roadmap is a view of
    // the memories, not a separate store.
    // By structure rather than by label: the class names are uppercased in
    // CSS, so the text in the DOM is not what the board reads as.
    await page.locator("ul button").first().click();
    await expect(page.locator("aside")).toBeVisible();
  });

  test("the canvas links to it and back", async ({ page }) => {
    await page.goto("/canvas/3d");
    await expect(page.locator("canvas").first()).toBeVisible();

    await page.getByRole("link", { name: "Roadmap" }).click();
    await expect(page.getByTestId("memory-count")).toBeVisible();

    await page.getByRole("link", { name: "Canvas" }).click();
    await expect(page.locator("canvas").first()).toBeVisible();
  });
});

test.describe("moving work", () => {
  const API = process.env.SYNAPSSE_API ?? "http://localhost:8000";

  async function statusOf(id: string) {
    const graph = await fetch(`${API}/graph`).then((r) => r.json());
    return graph.nodes.find((n: { id: string }) => n.id === id)?.status;
  }

  test("the status control writes through to the daemon", async ({ page }) => {
    await page.goto("/roadmap");
    await expect(page.getByTestId("memory-count")).toBeVisible();

    // The keyboard path, which is also the one a screen reader has.
    const card = page.locator("ul li").filter({ has: page.locator("select") }).first();
    const title = await card.locator("span.font-medium").first().textContent();
    const select = card.locator("select");
    const before = await select.inputValue();
    const after = before === "todo" ? "doing" : "todo";

    await select.selectOption(after);
    await page.waitForTimeout(800);

    const graph = await fetch(`${API}/graph`).then((r) => r.json());
    const stored = graph.nodes.find(
      (n: { title: string }) => n.title === title?.trim(),
    );
    expect(stored.status).toBe(after);

    // Put it back, so the test leaves the graph as it found it.
    await page
      .locator("ul li")
      .filter({ hasText: title!.trim() })
      .locator("select")
      .selectOption(before);
    await page.waitForTimeout(600);
    expect(await statusOf(stored.id)).toBe(before);
  });

  test("a move survives a reload", async ({ page }) => {
    await page.goto("/roadmap");
    await expect(page.getByTestId("memory-count")).toBeVisible();

    const card = page.locator("ul li").filter({ has: page.locator("select") }).first();
    const title = (await card.locator("span.font-medium").first().textContent())!.trim();
    const before = await card.locator("select").inputValue();
    const after = before === "done" ? "doing" : "done";

    await card.locator("select").selectOption(after);
    await page.waitForTimeout(800);

    await page.reload();
    await expect(page.getByTestId("memory-count")).toBeVisible();
    const reloaded = page.locator("ul li").filter({ hasText: title }).first();
    expect(await reloaded.locator("select").inputValue()).toBe(after);

    await reloaded.locator("select").selectOption(before);
    await page.waitForTimeout(600);
  });

  test("dragging a card to another lane moves it", async ({ page }) => {
    await page.goto("/roadmap");
    await expect(page.getByTestId("memory-count")).toBeVisible();

    const card = page.locator("ul li").filter({ has: page.locator("select") }).first();
    const title = (await card.locator("span.font-medium").first().textContent())!.trim();
    const before = await card.locator("select").inputValue();
    const target = before === "dropped" ? "Done" : "Dropped";
    const targetStatus = target.toLowerCase();

    await card.dragTo(
      page.locator("section").filter({ has: page.getByRole("heading", { name: target }) }),
    );
    await page.waitForTimeout(800);

    const moved = page.locator("ul li").filter({ hasText: title }).first();
    expect(await moved.locator("select").inputValue()).toBe(targetStatus);

    await moved.locator("select").selectOption(before);
    await page.waitForTimeout(600);
  });
});
