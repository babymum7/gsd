import { findByHandle } from "../accounts/users.js";

// Turns each @handle in a message into a link to that user's profile; an unknown handle stays as typed.
export function renderMentions(text) {
  return text.replace(/@(\w+)/g, (match, handle) => {
    const user = findByHandle(handle);
    return user ? `[@${user.handle}](/u/${user.id})` : match;
  });
}
