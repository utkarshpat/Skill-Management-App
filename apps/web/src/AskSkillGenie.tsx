import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import {
  certificationStatusLabels,
  credentialValidity,
} from './certifications/certification-model';
import type { CertificationRecord } from './certifications/types';
import type { CertificationPage } from './certifications/types';
import { recordFactsSeparator, type AssistantRecordContext } from './assistant-record';

export function recordQuestion(question: string, facts: readonly string[]) {
  const prefix = question + recordFactsSeparator;
  const context = facts
    .filter(Boolean)
    .map(fact => fact.replace(/\s+/g, ' '))
    .join('\n');
  return prefix + context.slice(0, 500 - prefix.length);
}

export function certificateQuestion(record: CertificationRecord, review = false) {
  return recordQuestion(
    review
      ? 'How should I check this certificate for approval?'
      : 'How do I check or renew this certificate?',
    [
      `Certificate: ${record.certificationName.slice(0, 110)}`,
      `Issuer: ${record.provider.slice(0, 70)}`,
      `Approval: ${certificationStatusLabels[record.status] ?? 'Unknown'}`,
      `Validity: ${credentialValidity(record.expiryDate, new Date().toISOString().slice(0, 10))}`,
      `Valid till: ${record.expiryDate ?? 'Lifetime'}`,
      record.activeRenewalId ? 'A renewal is already in progress.' : '',
      `Certificate file: ${record.hasImage ? 'recorded' : 'no file shown'}`,
    ],
  );
}

export async function readOwnCertificate(id: string, signal: AbortSignal) {
  const { record } = await readApiResponse<{ record: CertificationRecord }>(
    await authenticatedFetch(`/api/certifications/${encodeURIComponent(id)}`, { signal }),
    'This certificate could not be refreshed.',
  );
  if (record.id.toLowerCase() !== id.toLowerCase())
    throw Object.assign(new Error('This certificate is no longer available.'), { status: 404 });
  return record;
}

export function certificateContext(
  record: CertificationRecord,
  open: (record: CertificationRecord, action?: 'renew' | 'feedback') => void,
  mayRenew: boolean,
): AssistantRecordContext {
  const read = (signal: AbortSignal) => readOwnCertificate(record.id, signal);
  const actions: AssistantRecordContext['actions'] = [
    {
      label: 'Back to this record',
      run: async signal => {
        const latest = await read(signal);
        if (!signal.aborted) open(latest);
      },
    },
  ];
  if (mayRenew && record.status === 'APPROVED' && record.expiryDate && !record.supersededById) {
    actions.push({
      label: record.activeRenewalId ? 'Continue renewal' : 'Renew certificate',
      run: async signal => {
        const latest = await read(signal);
        const access = await readApiResponse<CertificationPage>(
          await authenticatedFetch('/api/certifications?view=mine&page=1&search=', { signal }),
          'Certificate renewal access could not be checked.',
        );
        if (
          !access.canManage ||
          !access.canUploadImage ||
          latest.status !== 'APPROVED' ||
          !latest.expiryDate ||
          latest.supersededById
        )
          throw new Error('This certificate is no longer available for renewal.');
        if (!signal.aborted) open(latest, 'renew');
      },
    });
  }
  if (
    (record.status === 'REJECTED' || record.status === 'CHANGES_REQUESTED') &&
    record.feedback?.trim()
  ) {
    actions.push({
      label: 'Open feedback',
      run: async signal => {
        const latest = await read(signal);
        if (!['REJECTED', 'CHANGES_REQUESTED'].includes(latest.status) || !latest.feedback?.trim())
          throw new Error('Feedback is no longer available for this certificate.');
        if (!signal.aborted) open(latest, 'feedback');
      },
    });
  }
  return { label: record.certificationName, actions };
}

export function focusRecordSection(section: 'evidence' | 'feedback') {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`dialog[open] [data-genie-section="${section}"]`)?.focus();
  });
}

export function AskSkillGenie({
  load,
  onOpen,
}: {
  load: (signal: AbortSignal) => Promise<{ prompt: string; record: AssistantRecordContext }>;
  onOpen: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController>(undefined);
  useEffect(() => () => request.current?.abort(), []);

  async function ask() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const detail = await load(controller.signal);
      if (controller.signal.aborted) return;
      const accepted = !window.dispatchEvent(
        new CustomEvent('assistant-context-request', {
          cancelable: true,
          detail: { prompt: detail.prompt, record: { ...detail.record, reload: load } },
        }),
      );
      if (!accepted) throw new Error('Skill Genie is unavailable or busy. Try again in a moment.');
      onOpen();
    } catch (reason) {
      if (!controller.signal.aborted) setError((reason as Error).message);
    } finally {
      if (!controller.signal.aborted) {
        request.current = undefined;
        setBusy(false);
      }
    }
  }

  return (
    <>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void ask()}>
        <Sparkles size={16} aria-hidden="true" /> {busy ? 'Checking record…' : 'Ask Skill Genie'}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
