/**
 * Things a step starts that must be stopped when the scenario ends (another sample server, a connection, an agent). They are
 * stopped in reverse order, also when the scenario failed, and a failure to stop one does not stop the rest.
 */
export class Cleanups {
  private readonly tasks: Array<() => unknown> = [];

  add(task: () => unknown): void {
    this.tasks.push(task);
  }

  async run(): Promise<void> {
    const failures: unknown[] = [];
    for (const task of this.tasks.reverse()) {
      try {
        await task();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  }
}
