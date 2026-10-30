import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Mixed suites are filtered so this command covers only the requested matching,
// connection, chat, planner and notification features. Existing tests are reused.
const batches = [
  { name: 'matching, connections, chats, planning and notifications', files: [
    'galeShapley', 'compatibility', 'hybridDirect', 'hybridReservations',
    'managedMatching', 'managedJoinLifecycle', 'admissionQueue', 'queueLifecycle',
    'groupDiscovery', 'proposalPresentation', 'groupChannel', 'connectionChannel',
    'messagePagination', 'chatCatchup', 'connectionChatClient', 'meetupCarPlanning',
    'meetupIntegrations', 'meetupRealtime', 'meetupTransport', 'nearbyTransport', 'carTravel', 'delivery', 'browserPush', 'pushWorker', 'providerSecurity',
  ] },
  { name: 'community HTTP flows', files: ['communityApi'], pattern: '^(?!feedback HTTP flow)' },
  { name: 'community ranking, approval, planning and notifications', files: ['community'],
    pattern: '^(recommendations use member answers|seeker chooses once|notification hooks|join request notifications|meetup |connected groups require|weather |friends-only groups|member blocks cannot|one pending choice|changed group preferences|seven-day meetup|departed members stop|unknown meetup|pending join preference changes)' },
  { name: 'Kaki chats', files: ['kakiChat'],
    pattern: '^(a conversation requires|authentication is required for every chat route|opening a conversation|opening or acknowledging|chat notifications|a non-participant|messages send|a burst|a reply|empty and oversized|edit and delete|deleting leaves|blocking closes|withdrawing a like|chat background|chat requires)' },
  { name: 'Kaki live chat and receipts', files: ['kakiRealtime'], pattern: '^(?!avatars are optional|a forged image|a picture can be changed)' },
  { name: 'marketplace chats', files: ['market'], pattern: '^(chat:|opening and polling ticket chats)' },
  { name: 'whole-group preference eligibility', files: ['matchingEligibility'], pattern: '^(group vetoes|a later preference change)' },
];
if (process.argv.includes('--list')) { console.log(JSON.stringify(batches, null, 2)); process.exit(0); }
const cwd = fileURLToPath(new URL('..', import.meta.url));
const reportDirectory = join(cwd, 'test-results', 'community');
mkdirSync(reportDirectory, { recursive: true });
const totals = { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0 };
let failed = false;
for (const batch of batches) {
  console.log(`Running ${batch.name}...`);
  const args = ['--test', '--test-concurrency=2', '--test-timeout=60000', '--test-reporter=tap'];
  if (batch.pattern) args.push(`--test-name-pattern=${batch.pattern}`);
  args.push(...batch.files.map(name => `test/${name}.test.js`));
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600000 });
  const log = join(reportDirectory, `${batch.files[0]}.tap`);
  writeFileSync(log, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  const counts = {};
  for (const key of Object.keys(totals)) {
    counts[key] = Number(result.stdout?.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? 0);
    totals[key] += counts[key];
  }
  console.log(JSON.stringify({ batch: batch.name, ...counts, exitCode: result.status }));
  if (result.status !== 0 || result.error || counts.tests === 0) {
    failed = true;
    console.error(`Failure details: ${log}`, result.error ?? '');
    const lines = (result.stdout ?? '').split('\n');
    lines.forEach((line, index) => {
      if (/^\s*not ok/.test(line)) console.error(lines.slice(index, index + 38).join('\n'));
    });
  }
}
console.log(JSON.stringify({ scope: 'requested community features only', ...totals }));
process.exitCode = failed ? 1 : 0;
