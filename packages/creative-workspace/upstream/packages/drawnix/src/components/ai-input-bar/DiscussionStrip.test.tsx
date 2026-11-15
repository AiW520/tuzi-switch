import React from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCollaborationPending } from '../../services/text-chat/collaboration-link';
vi.mock('../../services/text-chat/runtime', () => ({ textChatRuntime: {
  getSnapshot: () => ({ sessions: [{ id: 'session-1', textChat: {
    executionMode: 'agent', linkedBoardId: 'board-1', messages: [{ role: 'assistant', status: 'complete', content: 'Done' }],
  } }], running: new Set() }),
  subscribe: () => () => {},
} }));
vi.mock('../../services/task-queue', () => ({ taskQueueService: {
  observeTaskUpdates: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
} }));
import { DiscussionStrip } from './DiscussionStrip';
afterEach(() => { cleanup(); setCollaborationPending(undefined); });
describe('collapsed collaboration confirmation', () => {
  it('replaces completed status with a pending action and clears it after resolution', () => {
    render(<DiscussionStrip boardId="board-1" onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: '打开讨论：讨论已完成' })).toBeTruthy();
    act(() => setCollaborationPending({ scope: { boardId: 'board-1', sessionId: 'session-1' }, title: '插入文本' }));
    expect(screen.getByRole('button', { name: '打开讨论：协同操作待确认 · 插入文本' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('discussion-strip').getAttribute('data-phase')).toBe('ready');
    act(() => setCollaborationPending(undefined));
    expect(screen.getByRole('button', { name: '打开讨论：讨论已完成' })).toBeTruthy();
  });
  it('does not show another board approval after navigation', () => {
    setCollaborationPending({ scope: { boardId: 'board-1', sessionId: 'session-1' }, title: '插入文本' });
    const view = render(<DiscussionStrip boardId="board-1" onOpen={() => {}} />);
    expect(screen.getByRole('status').textContent).toContain('待确认');
    view.rerender(<DiscussionStrip boardId="board-2" onOpen={() => {}} />);
    expect(screen.getByRole('status').textContent).not.toContain('待确认');
  });
});
