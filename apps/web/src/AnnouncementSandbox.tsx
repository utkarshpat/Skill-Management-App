import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { authenticatedFetch } from './auth';
import type { Definition, Person } from './announcement-model';

export function AnnouncementSandbox({
  definition,
  person,
  image,
  surface = 'form',
  busy,
  answered,
  onSubmit,
  onVote,
  onOpen,
}: {
  definition: Definition;
  person: Person;
  image?: string;
  surface?: 'banner' | 'form';
  busy?: boolean;
  answered?: boolean;
  onSubmit?: (answers: Record<string, string | boolean>) => void;
  onVote?: (vote: string) => void;
  onOpen?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useRef(crypto.randomUUID());
  const port = useRef<MessagePort | undefined>(undefined);
  const [height, setHeight] = useState(300);
  const [imageData, setImageData] = useState<string>();
  const design = definition.design!;
  const theme = document.documentElement.dataset.theme ?? 'light';
  const current = useRef({
    definition,
    person,
    imageData,
    surface,
    busy,
    answered,
    onSubmit,
    onVote,
    onOpen,
    theme,
  });
  current.current = {
    definition,
    person,
    imageData,
    surface,
    busy,
    answered,
    onSubmit,
    onVote,
    onOpen,
    theme,
  };
  const render = () => {
    const value = current.current;
    port.current?.postMessage({
      type: 'announcement.render',
      channel: channel.current,
      html: value.definition.design?.html,
      css: value.definition.design?.css,
      bindings: value.definition.design?.bindings ?? [],
      definition: {
        title: value.definition.title,
        message: value.definition.message,
        fields: value.definition.fields,
        options: value.definition.options,
      },
      person: value.person,
      image: value.imageData,
      surface: value.surface,
      busy: !!value.busy,
      answered: !!value.answered,
      theme: value.theme,
    });
  };
  useEffect(() => {
    let active = true;
    setImageData(undefined);
    if (!image) return;
    if (/^data:image\/(png|jpeg|webp);base64,/.test(image)) {
      setImageData(image);
      return;
    }
    // Only images supplied by the app are fetched; generated HTML cannot supply a URL.
    if (!image.startsWith('/api/announcements/') && !image.startsWith('blob:')) return;
    const controller = new AbortController();
    authenticatedFetch(image, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const blob = await response.blob();
        if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type) || blob.size > 300_000)
          return;
        const reader = new FileReader();
        reader.onload = () => {
          if (active) setImageData(String(reader.result));
        };
        reader.readAsDataURL(blob);
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, [image]);
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.channel !== channel.current) return;
      if (event.data.type === 'announcement.height') {
        if (
          Number.isSafeInteger(event.data.height) &&
          event.data.height >= 64 &&
          event.data.height <= 1800
        )
          setHeight(event.data.height);
        return;
      }
      const value = current.current;
      if (event.data.type !== 'announcement.action' || value.busy || value.answered) return;
      if (event.data.action === 'open-form' && value.definition.kind === 'FORM') value.onOpen?.();
      if (
        event.data.action === 'vote' &&
        value.definition.kind === 'POLL' &&
        Number.isInteger(event.data.index) &&
        event.data.index >= 0 &&
        event.data.index < value.definition.options.length
      )
        value.onVote?.(value.definition.options[event.data.index]);
      if (event.data.action === 'submit' && value.definition.kind === 'FORM') {
        const answers = event.data.answers;
        if (
          !answers ||
          typeof answers !== 'object' ||
          Array.isArray(answers) ||
          Object.keys(answers).some(
            key => !value.definition.fields.some(field => field.id === key),
          ) ||
          Object.values(answers).some(
            answer => typeof answer !== 'string' && typeof answer !== 'boolean',
          )
        )
          return;
        value.onSubmit?.(answers);
      }
    };
    const connect = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (
        !target ||
        event.source !== target ||
        event.origin !== 'null' ||
        event.data?.type !== 'announcement.ready' ||
        event.data?.channel !== channel.current ||
        event.ports.length !== 1
      )
        return;
      port.current?.close();
      const next = event.ports[0];
      next.onmessage = receive;
      port.current = next;
      render();
    };
    window.addEventListener('message', connect);
    return () => {
      window.removeEventListener('message', connect);
      port.current?.close();
      port.current = undefined;
    };
  }, []);
  useEffect(render, [
    design,
    definition.title,
    definition.message,
    definition.fields,
    definition.options,
    person,
    imageData,
    surface,
    busy,
    answered,
    theme,
  ]);
  return (
    <iframe
      ref={frame}
      className="announcement-sandbox"
      title={definition.title + ' design'}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={'/announcement-sandbox.html#' + channel.current}
      style={{
        width: '100%',
        height: surface === 'banner' ? Math.min(160, height) : height,
        border: 0,
        display: 'block',
      }}
    />
  );
}
