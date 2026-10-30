// Notifications wait in a queue and go out together once an hour (decision 0005).
const queue = [];

export function resetNotifications() {
  queue.length = 0;
}

export function notify(userId, text) {
  queue.push({ userId, text });
}

// Returns one batch per user, in the order users were first notified, and empties the queue.
export function flushHourly() {
  const batches = new Map();
  for (const { userId, text } of queue) {
    if (!batches.has(userId)) batches.set(userId, []);
    batches.get(userId).push(text);
  }
  queue.length = 0;
  return [...batches].map(([userId, texts]) => ({ userId, texts }));
}
