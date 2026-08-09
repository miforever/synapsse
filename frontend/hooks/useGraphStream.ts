"use client";

import { useEffect, useRef, useState } from "react";

import { wsUrl } from "@/lib/api";
import {
  EVENT_NEW_NODE,
  EVENT_NODE_DELETED,
  EVENT_NODE_UPDATED,
  type GraphEvent,
  type GraphEventHandlers,
} from "@/lib/types";

const RETRY_DELAY_MS = 2000;

/**
 * Subscribes to live graph mutations.
 *
 * Handlers are held in a ref so the socket opens exactly once and survives
 * every parent re-render — resubscribing each render would tear the
 * connection down and rebuild it continuously.
 */
export function useGraphStream(handlers: GraphEventHandlers): boolean {
  const latest = useRef(handlers);
  latest.current = handlers;

  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      socket = new WebSocket(wsUrl());

      socket.onopen = () => setConnected(true);

      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          const message = JSON.parse(event.data) as GraphEvent;
          switch (message.event) {
            case EVENT_NEW_NODE:
              latest.current.onNewNode(
                message.payload.node,
                message.payload.edges,
              );
              break;
            case EVENT_NODE_UPDATED:
              latest.current.onNodeUpdated(message.payload.node);
              break;
            case EVENT_NODE_DELETED:
              latest.current.onNodeDeleted(message.payload.node_id);
              break;
          }
        } catch {
          // A malformed frame must never take the canvas down.
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (!disposed) retry = setTimeout(connect, RETRY_DELAY_MS);
      };

      // Let onclose drive reconnection so a failure isn't retried twice.
      socket.onerror = () => socket?.close();
    };

    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return connected;
}
