/**
 * ExpandContext — shares "which node is expanded" between the canvas, the
 * nodes, and the overlay without threading non-serializable callbacks through
 * React Flow node `data`. A node calls expand(id); the canvas renders the
 * overlay with a matching layoutId.
 */
import { createContext, useContext } from "react";

export interface ExpandApi {
  expandedId: string | null;
  expand: (id: string) => void;
  collapse: () => void;
}

export const ExpandContext = createContext<ExpandApi>({
  expandedId: null,
  expand: () => {},
  collapse: () => {},
});

export const useExpand = () => useContext(ExpandContext);
