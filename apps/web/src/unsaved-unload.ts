/** A native warning protects refresh/tab closure; it does not save the form. */
export function warnUnsavedUnload(event: BeforeUnloadEvent, pending: boolean) {
  if (!pending) return;
  event.preventDefault();
  event.returnValue = '';
}
