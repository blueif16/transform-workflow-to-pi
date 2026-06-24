/**
 * Shared status helpers — the label + tone mapping used by the overlay header,
 * status pill, field blocks, and progress. Kept in one place so every surface
 * speaks the same status language.
 */
import type { NodeStatus } from "./WorkflowNode";
import type { FieldTone } from "./FieldBlock";

export const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: "Idle",
  selected: "Selected",
  running: "Running",
  success: "Success",
  error: "Error",
};

export function statusTone(status: NodeStatus): FieldTone {
  if (status === "success") return "success";
  if (status === "error") return "error";
  if (status === "running" || status === "selected") return "accent";
  return "default";
}
