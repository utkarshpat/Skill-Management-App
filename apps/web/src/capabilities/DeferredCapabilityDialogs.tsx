import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import { FormDialog } from '../FormDialog';

const Composer = lazy(() =>
  import('./CapabilityComposer').then(module => ({ default: module.CapabilityComposer })),
);
const Review = lazy(() =>
  import('./CapabilityReview').then(module => ({ default: module.CapabilityReview })),
);

class DialogLoadBoundary extends Component<
  { onClose: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <FormDialog title="Submission unavailable" onClose={this.props.onClose}>
          <p role="alert">
            The submission dialog could not load. Close it and refresh the page before retrying.
          </p>
        </FormDialog>
      );
    return this.props.children;
  }
}

// Keep the portfolio visible while loading an editor, with a cancellable modal.
export function CapabilityComposer(props: ComponentProps<typeof Composer>) {
  return (
    <DialogLoadBoundary onClose={props.onClose}>
      <Suspense
        fallback={
          <FormDialog title="Loading submission…" onClose={props.onClose}>
            <p role="status">Loading editor…</p>
          </FormDialog>
        }
      >
        <Composer {...props} />
      </Suspense>
    </DialogLoadBoundary>
  );
}

export function CapabilityReview(props: ComponentProps<typeof Review>) {
  return (
    <DialogLoadBoundary onClose={props.onClose}>
      <Suspense
        fallback={
          <FormDialog title="Loading submission…" onClose={props.onClose}>
            <p role="status">Loading details…</p>
          </FormDialog>
        }
      >
        <Review {...props} />
      </Suspense>
    </DialogLoadBoundary>
  );
}
