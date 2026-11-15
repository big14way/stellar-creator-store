// One transaction at a time per source account. The network accepts one
// pending transaction per account, and each needs the next sequence number,
// so two submissions at once would collide.

export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}
