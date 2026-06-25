// UI configuration.
//
// READONLY — read-only mode. In a first version the board is
// editable ONLY by AI Agents (via HTTP), never by the user from the UI.
// This flag hides all write affordances in the frontend
// (create/edit/delete, drag-and-drop, document editors):
// navigation and browsing remain available.
//
// The backend REST API remains open regardless: this is a product
// constraint on the interface, not a security barrier. Default: true.
// To re-enable editing from the UI: VITE_READONLY=false.
const raw = import.meta.env.VITE_READONLY;
export const READONLY =
  raw === undefined ? true : !(raw === "false" || raw === "0" || raw === false);
