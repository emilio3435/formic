/* Operator sentences for identity routing. Server stamps `target.reason`
   from these. The client prints the reason; it does not invent a second
   sentence. Strip cmux UUIDs before a string that is not one of these
   reaches a hover. */

export const SHARED_HOST_REASON =
  "Several Grok chats share this terminal; Send stays off until the pane is one chat.";

export const TWO_OWNER_REASON =
  "Two sessions share this terminal; Send stays off until one leaves.";
