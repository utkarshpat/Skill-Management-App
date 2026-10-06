// UI lifecycle only; conversation IDs and authorization remain server-owned.
export class AssistantSession {
  visible = false;
  restartOnOpen = false;
  epoch = 0;
  open() {
    const restart = this.restartOnOpen;
    this.restartOnOpen = false;
    this.visible = true;
    return restart;
  }
  collapse() {
    this.visible = false;
  }
  close() {
    this.restartOnOpen = true;
    this.collapse();
  }
  newConversation() {
    this.epoch++;
  }
  completion(epoch: number) {
    return { current: epoch === this.epoch, notify: !this.visible || epoch !== this.epoch };
  }
}
