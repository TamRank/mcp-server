/** Private local retention only. This module grants no scan or recovery authority. */
import { constants as F } from 'node:fs';
import { open, lstat, realpath, opendir, link, unlink, mkdir } from 'node:fs/promises';
import { isAbsolute, resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const FORMAT = 'tamrank-scan-receipt-1';
const MAX_RECORD_BYTES = 16384;
export const MAX_SCAN_RECEIPTS = 100;
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const requestId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/;
const refPattern = /^receipt_[a-f0-9]{64}$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export class ScanReceiptError extends Error {
  constructor(code = 'scan_receipt_storage_unavailable') {
    super('Private recovery receipt storage is unavailable. Do not repeat the measurement.');
    this.name = 'ScanReceiptError'; this.code = code;
  }
}

export function receiptSite(siteUrl) {
  try {
    if (typeof siteUrl !== 'string' || siteUrl.length > 2048) throw new Error();
    const url = new URL(siteUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new Error();
    return url.href.replace(/\/+$/, '');
  } catch { throw new ScanReceiptError('scan_receipt_context_invalid'); }
}

/** Structural check only; only WordPress can authenticate the HMAC and result. */
export function isScanReceipt(value) {
  return typeof value === 'string' && value.length <= 8192
    && /^trsr1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(value);
}

function identity(input) {
  if (!exact(input, ['site_url', 'execution_id', 'measurement_id', 'attempt_request_id', 'attempt_runtime_hash', 'result_receipt'])
    || typeof input.execution_id !== 'string' || !uuid.test(input.execution_id)
    || typeof input.measurement_id !== 'string' || !digest.test(input.measurement_id)
    || typeof input.attempt_request_id !== 'string' || !requestId.test(input.attempt_request_id)
    || typeof input.attempt_runtime_hash !== 'string' || !digest.test(input.attempt_runtime_hash)
    || !isScanReceipt(input.result_receipt)) throw new ScanReceiptError('scan_receipt_context_invalid');
  return { site_url: receiptSite(input.site_url), execution_id: input.execution_id,
    measurement_id: input.measurement_id, attempt_request_id: input.attempt_request_id, attempt_runtime_hash: input.attempt_runtime_hash,
    result_receipt: input.result_receipt };
}
const reference = input => 'receipt_' + hash(JSON.stringify(identity(input)));
const safeError = error => error instanceof ScanReceiptError ? error : new ScanReceiptError();
async function boundedEntries(directory){const entries=[];
  for await(const entry of await opendir(directory)){
    if(entries.length>=MAX_SCAN_RECEIPTS+2)throw new ScanReceiptError('scan_receipt_storage_full');entries.push(entry.name);
  }return entries;
}

/** Explicit local setup only. Never creates ancestors, repairs permissions or reuses an existing path. */
export async function initializeReceiptDirectory(directory){
  try {
    if(typeof directory!=='string' || !isAbsolute(directory) || typeof process.getuid!=='function')throw new Error();
    const target=resolve(directory),parent=dirname(target),p=await lstat(parent);
    if(await realpath(parent)!==parent || !p.isDirectory() || p.uid!==process.getuid() || (p.mode & 0o022)!==0)throw new Error();
    await mkdir(target,{mode:0o700});
    await new ScanReceiptStore({directory:target}).checkReadable();
    return {created:true};
  } catch {throw new ScanReceiptError('scan_receipt_setup_refused');}
}

/**
 * An explicitly configured, pre-existing private POSIX directory. No default path,
 * automatic mkdir/chmod, startup initialization, TTL eviction or background work.
 * The configured directory/parents and processes running as this OS user are trusted.
 */
export class ScanReceiptStore {
  #directory;
  constructor({ directory }) {
    if (typeof directory !== 'string' || !isAbsolute(directory) || typeof process.getuid !== 'function'
      || !F.O_NOFOLLOW) throw new ScanReceiptError('scan_receipt_storage_unsupported');
    this.#directory = resolve(directory);
  }
  #file(ref) {
    if (typeof ref !== 'string' || !refPattern.test(ref)) throw new ScanReceiptError('scan_receipt_reference_invalid');
    return join(this.#directory, ref + '.json');
  }
  #private(stat, directory = false) {
    return (directory ? stat.isDirectory() : stat.isFile()) && stat.uid === process.getuid()
      && (stat.mode & 0o7777) === (directory ? 0o700 : 0o600) && (directory || stat.nlink === 1);
  }
  async #root() {
    if (await realpath(this.#directory) !== this.#directory) throw new ScanReceiptError();
    const stat = await lstat(this.#directory);
    if (!this.#private(stat, true)) throw new ScanReceiptError();
    const handle = await open(this.#directory, F.O_RDONLY | F.O_DIRECTORY | F.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!this.#private(opened, true) || opened.dev !== stat.dev || opened.ino !== stat.ino) throw new ScanReceiptError();
      return handle;
    } catch (error) { await handle.close(); throw error; }
  }
  /** Read-only readiness check, not a reservation or guarantee against later I/O loss. */
  async checkReadable(){let root;try{root=await this.#root();}catch(error){throw safeError(error);}finally{await root?.close();}}
  async checkReady() {
    let root;
    try {
      root = await this.#root();
      const entries = await boundedEntries(this.#directory);
      if (entries.includes('.write-lock')) throw new ScanReceiptError('scan_receipt_storage_busy');
      if (entries.length >= MAX_SCAN_RECEIPTS) throw new ScanReceiptError('scan_receipt_storage_full');
    } catch (error) { throw safeError(error); }
    finally { await root?.close().catch(() => {}); }
  }
  async #read(ref) {
    let handle;
    try {
      handle = await open(this.#file(ref), F.O_RDONLY | F.O_NOFOLLOW | F.O_NONBLOCK);
      const stat = await handle.stat();
      if (!this.#private(stat) || stat.size < 1 || stat.size > MAX_RECORD_BYTES) throw new ScanReceiptError();
      const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1);
      let total = 0;
      while (total < bytes.length) {
        const read = await handle.read(bytes, total, bytes.length - total, null);
        if (!read.bytesRead) break;
        total += read.bytesRead;
      }
      if (total !== stat.size) throw new ScanReceiptError();
      const record = JSON.parse(bytes.subarray(0, total).toString('utf8'));
      if (!exact(record, ['format', 'stored_at', 'receipt']) || record.format !== FORMAT
        || !Number.isSafeInteger(record.stored_at) || record.stored_at < 1 || reference(record.receipt) !== ref
        || JSON.stringify(identity(record.receipt)) !== JSON.stringify(record.receipt)) throw new ScanReceiptError();
      return record;
    } finally { await handle?.close(); }
  }
  async save(input) {
    let root, lock, temp, tempHandle, published = false;
    try {
      const receipt = identity(input), ref = reference(receipt), file = this.#file(ref);
      root = await this.#root();
      // No stale-lock stealing: another process may still own a pending save.
      try { lock = await open(join(this.#directory, '.write-lock'), F.O_WRONLY | F.O_CREAT | F.O_EXCL | F.O_NOFOLLOW, 0o600); }
      catch (error) { if (error.code === 'EEXIST') throw new ScanReceiptError('scan_receipt_storage_busy'); throw error; }
      try {
        await this.#read(ref);
        await root.sync();
        return { receipt_reference: ref, retained: true, replayed: true };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const entries = await boundedEntries(this.#directory);
      // Count incomplete saves too; never evict somebody else's private evidence.
      if (entries.filter(name => name !== '.write-lock').length >= MAX_SCAN_RECEIPTS)
        throw new ScanReceiptError('scan_receipt_storage_full');
      const record = { format: FORMAT, stored_at: Date.now(), receipt };
      const bytes = JSON.stringify(record);
      if (Buffer.byteLength(bytes) > MAX_RECORD_BYTES) throw new ScanReceiptError();
      temp = join(this.#directory, '.pending-' + randomUUID());
      tempHandle = await open(temp, F.O_WRONLY | F.O_CREAT | F.O_EXCL | F.O_NOFOLLOW, 0o600);
      await tempHandle.writeFile(bytes, 'utf8'); await tempHandle.sync(); await tempHandle.close(); tempHandle = null;
      // Publish without replacing any pre-existing record, even after a race.
      await link(temp, file); published = true;
      await unlink(temp); temp = null;
      await this.#read(ref); await root.sync();
      return { receipt_reference: ref, retained: true, replayed: false };
    } catch (error) { throw safeError(error); }
    finally {
      await tempHandle?.close().catch(() => {});
      // Before publication this is our incomplete file; afterwards keep both names
      // if cleanup failed. A private ambiguous record must never be overwritten.
      if (temp && !published) await unlink(temp).catch(() => {});
      if (lock) {
        await lock.close().catch(() => {});
        await unlink(join(this.#directory, '.write-lock')).catch(() => {});
      }
      await root?.close().catch(() => {});
    }
  }
  /** Internal recovery driver only: never return the record through an MCP tool. */
  async load(ref, { site_url, execution_id }) {
    let root;
    try {
      const site = receiptSite(site_url);
      if (typeof execution_id !== 'string' || !uuid.test(execution_id)) throw new ScanReceiptError('scan_receipt_context_invalid');
      root = await this.#root();
      const record = await this.#read(ref);
      if (record.receipt.site_url !== site || record.receipt.execution_id !== execution_id)
        throw new ScanReceiptError('scan_receipt_context_mismatch');
      return record;
    } catch (error) { throw safeError(error); }
    finally { await root?.close().catch(() => {}); }
  }
  /** Bounded local inventory, only for the explicitly requested site. No packets or foreign-site details. */
  async list({site_url}){
    let root;
    try {
      const site=receiptSite(site_url);root=await this.#root();const entries=await boundedEntries(this.#directory);
      const items=[];let incomplete=0;
      for(const name of entries.sort()){
        if(!/^receipt_[a-f0-9]{64}\.json$/.test(name)){incomplete++;continue;}
        const ref=name.slice(0,-5),record=await this.#read(ref);
        if(record.receipt.site_url===site)items.push({receipt_reference:ref,execution_id:record.receipt.execution_id,stored_at:record.stored_at});
      }
      return {items,incomplete_entries:incomplete,write_busy:entries.includes('.write-lock'),private_result_returned:false};
    } catch(error){throw safeError(error);}finally{await root?.close();}
  }
  /** Inspection grants no server settlement and explicitly warns before local evidence erasure. */
  async inspect(ref,context){
    const record=await this.load(ref,context);
    return {receipt_reference:ref,execution_id:record.receipt.execution_id,stored_at:record.stored_at,
      deletion_hash:hash(JSON.stringify(record)),required_confirmation:'DELETE_PRIVATE_RECEIPT',
      warning:'Deleting this local file may remove the only retained evidence. It does not settle, stop or retry a server scan.',private_result_returned:false};
  }
  /** Explicit exact-record removal under the same exclusive writer lock. Never stale-lock stealing. */
  async remove(ref,context,{expected_hash,confirmation}={}){
    if(typeof expected_hash!=='string' || !digest.test(expected_hash) || confirmation!=='DELETE_PRIVATE_RECEIPT')
      throw new ScanReceiptError('scan_receipt_delete_confirmation_required');
    let root,lock,removed=false;
    try {
      root=await this.#root();
      try{lock=await open(join(this.#directory,'.write-lock'),F.O_WRONLY|F.O_CREAT|F.O_EXCL|F.O_NOFOLLOW,0o600);}
      catch(error){if(error.code==='EEXIST')throw new ScanReceiptError('scan_receipt_storage_busy');throw error;}
      const preview=await this.inspect(ref,context);
      if(preview.deletion_hash!==expected_hash)throw new ScanReceiptError('scan_receipt_delete_changed');
      await unlink(this.#file(ref));removed=true;await root.sync();
      return {removed:true,receipt_reference:ref,server_changed:false,recoverable_from_this_store:false};
    } catch(error){if(removed)throw new ScanReceiptError('scan_receipt_delete_acknowledgement_uncertain');throw safeError(error);}
    finally{if(lock){await lock.close().catch(()=>{});await unlink(join(this.#directory,'.write-lock')).catch(()=>{});}await root?.close();}
  }
  /** Explicit private export to a NEW file in an existing private directory; never prints packet bytes. */
  async export(ref,context,destination){
    let root,file;
    try{
      const record=await this.load(ref,context);
      if(typeof destination!=='string' || !isAbsolute(destination) || resolve(destination)!==destination)throw new Error();
      const parent=dirname(destination),stat=await lstat(parent);
      if(await realpath(parent)!==parent || !this.#private(stat,true))throw new Error();
      root=await open(parent,F.O_RDONLY|F.O_DIRECTORY|F.O_NOFOLLOW);
      file=await open(destination,F.O_WRONLY|F.O_CREAT|F.O_EXCL|F.O_NOFOLLOW,0o600);
      await file.writeFile(JSON.stringify(record),'utf8');await file.sync();await file.close();file=null;await root.sync();
      return {exported:true,source_retained:true,contains_private_result:true};
    }catch{throw new ScanReceiptError('scan_receipt_export_refused_or_uncertain');}
    finally{await file?.close().catch(()=>{});await root?.close();}
  }
}
