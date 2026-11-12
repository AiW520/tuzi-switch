import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { kvStorageService } from './kv-storage-service';
import { runOnce } from './text-chat/collaboration-core';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does not execute a journaled operation when the intent transaction rolls back after put succeeds', async () => {
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
    const request = put.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  const effect = vi.fn();
  await expect(runOnce(kvStorageService, 'intent', 'signature', effect)).rejects.toThrow('aborted');
  expect(effect).not.toHaveBeenCalled();
  expect(await kvStorageService.get('intent')).toBeNull();
});

it('returns only after a value has committed and is readable from another connection', async () => {
  await kvStorageService.set('committed', { taskIds: ['synthetic-job'] }, { durability: 'strict' });
  expect(await kvStorageService.get('committed', { strict: true })).toEqual({ taskIds: ['synthetic-job'] });
});

it('does not confuse unavailable storage with a missing journal record', async () => {
  vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('Synthetic storage unavailable'); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(kvStorageService.get('intent', { strict: true })).rejects.toThrow('Synthetic storage unavailable');
});
