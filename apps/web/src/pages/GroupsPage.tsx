import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,Tab,Tabs,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {CollectorHistory} from '../components/CollectorHistory';
import { CollectorWorkerPanel } from '../components/CollectorWorkerPanel';
import { apiGet, apiSend } from '../api/client';

interface Group {
  id: string;
  friendlyName: string;
  canonicalGroupUrl: string;
  facebookGroupId?: string | null;
  enabled: boolean;
  baselineStatus: string;
  baselineCompletedAt?: string | null;
  lastTestStatus?: string | null;
  lastTestedAt?: string | null;
  lastSuccessfulMonitorAt?: string | null;
  lastErrorMessage?: string | null;
  maxPostsPerRun?: number | null;
  maxScrollActions?: number | null;
  maxGroupDurationSeconds?: number | null;
}

interface LimitDraft {
  maxPostsPerRun: string;
  maxScrollActions: string;
  maxGroupDurationSeconds: string;
}

function draftFromGroup(group: Group): LimitDraft {
  return {
    maxPostsPerRun: group.maxPostsPerRun?.toString() ?? '',
    maxScrollActions: group.maxScrollActions?.toString() ?? '',
    maxGroupDurationSeconds: group.maxGroupDurationSeconds?.toString() ?? '',
  };
}

function nullableNumber(value: string) {
  const trimmed = value.trim();
  return trimmed === '' ? null : Number(trimmed);
}

/** Mirror of API normalizeFacebookGroupUrl for client-side duplicate checks. */
function tryNormalizeGroupUrl(input: string): string | undefined {
  const raw = input.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return undefined;
  }
  if (!['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(url.hostname.toLowerCase())) {
    return undefined;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const groupIndex = parts.findIndex((part) => part.toLowerCase() === 'groups');
  if (groupIndex === -1 || !parts[groupIndex + 1]) return undefined;
  const groupSlug = decodeURIComponent(parts[groupIndex + 1]).toLowerCase();
  return `https://www.facebook.com/groups/${encodeURIComponent(groupSlug)}`;
}

function matchesSearch(group: Group, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return (
    group.friendlyName.toLowerCase().includes(term)
    || group.canonicalGroupUrl.toLowerCase().includes(term)
    || decodeURIComponent(group.canonicalGroupUrl).toLowerCase().includes(term)
  );
}

export function GroupsPage() {
  const [historyTab,setHistoryTab]=useState(0);
  const [numericIds, setNumericIds] = useState<Record<string,string>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [drafts, setDrafts] = useState<Record<string, LimitDraft>>({});
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [highlightedId, setHighlightedId] = useState<string>();

  const load = () => apiGet<Group[]>('/groups')
    .then((nextGroups) => {
      setGroups(nextGroups);
      setDrafts(Object.fromEntries(nextGroups.map((group) => [group.id, draftFromGroup(group)])));
    })
    .catch(() => setGroups([]));

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredGroups = useMemo(
    () => groups.filter((group) => matchesSearch(group, search)),
    [groups, search],
  );

  const normalizedDraftUrl = tryNormalizeGroupUrl(url);
  const existingByUrl = useMemo(
    () => (normalizedDraftUrl
      ? groups.find((group) => group.canonicalGroupUrl === normalizedDraftUrl)
      : undefined),
    [groups, normalizedDraftUrl],
  );
  const existingByName = useMemo(() => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return undefined;
    return groups.find((group) => group.friendlyName.toLowerCase() === trimmed);
  }, [groups, name]);

  function openAdd() {
    setUrl('');
    setName('');
    setError(undefined);
    setAddOpen(true);
  }

  function closeAdd() {
    setAddOpen(false);
    setUrl('');
    setName('');
  }

  function showExisting(group: Group) {
    closeAdd();
    setSearch(group.friendlyName);
    setHighlightedId(group.id);
    setMessage(`“${group.friendlyName}” is already in your list.`);
    window.setTimeout(() => {
      document.getElementById(`group-card-${group.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    window.setTimeout(() => setHighlightedId(undefined), 4000);
  }

  async function add() {
    if (existingByUrl) {
      showExisting(existingByUrl);
      return;
    }
    setBusy('add');
    setError(undefined);
    setMessage(undefined);
    try {
      const created = await apiSend<Group>('/groups', 'POST', { facebookGroupUrl: url, friendlyName: name });
      closeAdd();
      setMessage(`Added ${created.friendlyName}.`);
      setSearch('');
      setHighlightedId(created.id);
      await load();
      window.setTimeout(() => setHighlightedId(undefined), 4000);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      const already = groups.find((group) => text.includes(group.friendlyName) || text.toLowerCase().includes('already exists'));
      if (already || /already exists/i.test(text)) {
        if (already) showExisting(already);
        else setError(text);
      } else {
        setError(text);
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function action(group: Group, kind: 'test' | 'run') {
    setBusy(`${kind}:${group.id}`);
    setError(undefined);
    setMessage(undefined);
    try {
      await apiSend('/collector/worker/start', 'POST', {mode:kind === 'test' ? 'test' : 'run',groupIds:[group.id]});
      setMessage(`${kind === 'test' ? 'Access test' : 'Collection'} started for ${group.friendlyName}. Progress appears above.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function saveLimits(group: Group) {
    const draft = drafts[group.id] ?? draftFromGroup(group);
    setBusy(`limits:${group.id}`);
    setError(undefined);
    try {
      await apiSend(`/groups/${group.id}`, 'PATCH', {
        maxPostsPerRun: nullableNumber(draft.maxPostsPerRun),
        maxScrollActions: nullableNumber(draft.maxScrollActions),
        maxGroupDurationSeconds: nullableNumber(draft.maxGroupDurationSeconds),
      });
      setMessage('Crawl limits saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function clearData(group: Group) {
    if (!window.confirm(`Delete collected posts and run history for ${group.friendlyName}? The group will stay configured.`)) return;
    setBusy(`clear:${group.id}`);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await apiSend<{ deletedPosts?: number; deletedRuns?: number; deletedEvents?: number }>(`/groups/${group.id}/clear-data`, 'POST');
      setMessage(`Cleared ${result.deletedPosts ?? 0} post(s), ${result.deletedRuns ?? 0} run(s), and ${result.deletedEvents ?? 0} event(s).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function markRebaseline(group: Group) {
    setBusy(`rebaseline:${group.id}`);
    setError(undefined);
    setMessage(undefined);
    try {
      await apiSend(`/groups/${group.id}/rebaseline`, 'POST');
      setMessage(`${group.friendlyName} will run as a baseline next time.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function removeGroup(group: Group) {
    if (!window.confirm(`Delete ${group.friendlyName} and its collected posts?`)) return;
    setBusy(`delete:${group.id}`);
    setError(undefined);
    setMessage(undefined);
    try {
      await apiSend(`/groups/${group.id}`, 'DELETE');
      setMessage('Group deleted.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  function setLimit(groupId: string, key: keyof LimitDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [groupId]: {
        ...(current[groupId] ?? { maxPostsPerRun: '', maxScrollActions: '', maxGroupDurationSeconds: '' }),
        [key]: value,
      },
    }));
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
        <Typography variant="h4">Groups</Typography>
        <Button variant="contained" onClick={openAdd}>Add Group</Button>
      </Stack>

      <Tabs value={historyTab} onChange={(_,value)=>setHistoryTab(value)}><Tab label="Groups"/><Tab label="Collection history"/></Tabs>
      {historyTab===1&&<CollectorHistory/>}
      <Box sx={{display:historyTab===0?'block':'none'}}><Stack spacing={3}>
      <CollectorWorkerPanel />
      {message && <Alert severity="success" onClose={() => setMessage(undefined)}>{message}</Alert>}
      {error && <Alert severity="error" onClose={() => setError(undefined)}>{error}</Alert>}

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <TextField
              size="small"
              label="Search groups"
              placeholder="Filter by name or Facebook URL"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              fullWidth
            />
            <Typography color="text.secondary">
              {search.trim()
                ? `${filteredGroups.length} of ${groups.length} group(s)`
                : `${groups.length} group(s)`}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      {filteredGroups.length === 0 ? (
        <Card>
          <CardContent>
            <Typography color="text.secondary">
              {groups.length === 0
                ? 'No groups yet. Add a Facebook group to get started.'
                : 'No groups match this search.'}
            </Typography>
          </CardContent>
        </Card>
      ) : filteredGroups.map((g) => {
        const draft = drafts[g.id] ?? draftFromGroup(g);
        const isBaselineRun = ['never_scanned', 'needs_rebaseline', 'baseline_failed'].includes(g.baselineStatus);
        return (
          <Card
            key={g.id}
            id={`group-card-${g.id}`}
            variant="outlined"
            sx={highlightedId === g.id ? { borderColor: 'primary.main', borderWidth: 2 } : undefined}
          >
            <CardContent>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="h6">{g.friendlyName}</Typography>
                  <Chip size="small" label={g.enabled ? 'Enabled' : 'Disabled'} />
                  <Chip
                    size="small"
                    label={`Access: ${g.lastTestStatus ?? 'untested'}`}
                    color={g.lastTestStatus === 'accessible' ? 'success' : g.lastTestStatus ? 'warning' : 'default'}
                  />
                </Stack>
                <Typography>{g.canonicalGroupUrl}</Typography>
                {!/\/groups\/\d+\/?$/.test(g.canonicalGroupUrl) && <Stack direction="row" spacing={1}>
                  <TextField size="small" label="Numeric Facebook group ID" value={numericIds[g.id] ?? g.facebookGroupId ?? ''} onChange={e=>setNumericIds({...numericIds,[g.id]:e.target.value})} />
                  <Button onClick={()=>{const value=(numericIds[g.id] ?? g.facebookGroupId ?? '').trim();if(!/^\d+$/.test(value)){setError('Enter the numeric group ID, not its name.');return;}void apiSend(`/groups/${g.id}`,'PATCH',{facebookGroupId:value}).then(load).catch(err=>setError(String(err)));}}>Save ID</Button>
                </Stack>}

                <Typography color="text.secondary">
                  Historical browser baseline: {g.baselineStatus}
                  {g.baselineCompletedAt ? ` (${new Date(g.baselineCompletedAt).toLocaleString()})` : ''}
                  {' · '}Last test: {g.lastTestedAt ? new Date(g.lastTestedAt).toLocaleString() : 'Never'}
                  {' · '}Last run: {g.lastSuccessfulMonitorAt ? new Date(g.lastSuccessfulMonitorAt).toLocaleString() : 'Never'}
                </Typography>
                {g.lastErrorMessage && <Typography color="error">{g.lastErrorMessage}</Typography>}
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button variant="outlined" disabled={Boolean(busy)} onClick={() => void action(g, 'test')}>
                    {busy === `test:${g.id}` ? 'Testing...' : 'Test Access'}
                  </Button>
                  <Button variant="contained" disabled={Boolean(busy) || !g.enabled} onClick={() => void action(g, 'run')}>
                    {busy === `run:${g.id}` ? 'Starting...' : 'Collect Group'}
                  </Button>
                  <Button disabled={Boolean(busy)} onClick={() => void apiSend(`/groups/${g.id}`, 'PATCH', {enabled:!g.enabled}).then(load).catch(err=>setError(String(err)))}>{g.enabled ? 'Disable Collection' : 'Enable Collection'}</Button>
                  <Button color="warning" disabled={Boolean(busy)} onClick={() => void clearData(g)}>
                    {busy === `clear:${g.id}` ? 'Clearing...' : 'Clear Data'}
                  </Button>
                  <Button color="error" disabled={Boolean(busy)} onClick={() => void removeGroup(g)}>
                    {busy === `delete:${g.id}` ? 'Deleting...' : 'Delete Group'}
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={addOpen} onClose={closeAdd} fullWidth maxWidth="sm">
        <DialogTitle>Add Group</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Facebook group URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoFocus
              fullWidth
              placeholder="https://www.facebook.com/groups/..."
              error={Boolean(existingByUrl)}
              helperText={normalizedDraftUrl && !existingByUrl ? `Will save as ${normalizedDraftUrl}` : undefined}
            />
            <TextField
              label="Friendly name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              fullWidth
              placeholder="Optional display name"
            />

            {existingByUrl && (
              <Alert
                severity="warning"
                action={(
                  <Button color="inherit" size="small" onClick={() => showExisting(existingByUrl)}>
                    Show existing
                  </Button>
                )}
              >
                Already created: <strong>{existingByUrl.friendlyName}</strong>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {existingByUrl.canonicalGroupUrl}
                </Typography>
              </Alert>
            )}

            {!existingByUrl && existingByName && (
              <Alert
                severity="info"
                action={(
                  <Button color="inherit" size="small" onClick={() => showExisting(existingByName)}>
                    Show existing
                  </Button>
                )}
              >
                A group named “{existingByName.friendlyName}” already exists
                ({existingByName.canonicalGroupUrl}). You can still add this if the URL is different.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAdd}>Cancel</Button>
          <Button
            variant="contained"
            disabled={Boolean(busy) || !url.trim() || Boolean(existingByUrl)}
            onClick={() => void add()}
          >
            {busy === 'add' ? 'Adding...' : existingByUrl ? 'Already added' : 'Add Group'}
          </Button>
        </DialogActions>
      </Dialog>
      </Stack></Box>
    </Stack>
  );
}
