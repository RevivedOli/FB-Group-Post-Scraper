import {DismissReferralDialog,MemberFeedbackPanel} from '../components/MemberFeedback';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import type { ReferralDirectoryResponse } from '@local-group-monitor/shared';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { apiGet, apiGetText, apiSend } from '../api/client';
import { PostLinkActions } from '../components/PostLinkActions';

interface ReferralMember {
  id: string;
  name: string;
  businessName?: string | null;
  facebookName?: string | null;
  facebookProfileUrl?: string | null;
  category: string;
  keywords: string;
  servicesOffered?: string | null;
  idealReferral?: string | null;
  negativeKeywords?: string | null;
  notes?: string | null;
  active: boolean;
  aiMatchCounts?: {
    total: number;
    new: number;
    copied: number;
    introduced: number;
    dismissed: number;
    not_relevant: number;
  };
}

interface MemberAiMatch {
  id: string;
  note?: string | null;
  score: number;
  scorePercent: string;
  reason?: string | null;
  suggestedIntro?: string | null;
  status: string;
  assessment: {
    intent?: string | null;
    summary?: string | null;
    confidence?: number | null;
    post: {
      id: string;
      canonicalPostUrl: string;
      latestCapturedText?: string | null;
      authorName?: string | null;
      firstDiscoveredAt: string;
      originalPostedAt?: string | null;
      hasRealPermalink?: boolean;
      searchPostUrl?: string | null;
      openPostUrl?: string;
      searchExcerpt?: string | null;
      group?: { friendlyName: string };
    };
  };
}

interface MemberMatchResponse {
  member: ReferralMember;
  items: MemberAiMatch[];
  total: number;
}

interface CsvPreview {
  total: number;
  valid: number;
  duplicates: number;
  invalid: number;
}

const emptyDraft = {
  name: '',
  businessName: '',
  facebookName: '',
  facebookProfileUrl: '',
  category: '',
  keywords: '',
  servicesOffered: '',
  idealReferral: '',
  negativeKeywords: '',
  notes: '',
};

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function HelpTip({ title }: { title: string }) {
  return (
    <Tooltip title={title} arrow>
      <IconButton size="small" sx={{ color: 'text.secondary' }}>
        <HelpOutlineIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

export function ReferralDirectoryPage() {
  const [dismissMatch,setDismissMatch]=useState<MemberAiMatch>();
  const [feedbackRefresh,setFeedbackRefresh]=useState(0);
  const [members, setMembers] = useState<ReferralMember[]>([]);
  const [counts, setCounts] = useState<ReferralDirectoryResponse['matchCounts']>();
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [csvText, setCsvText] = useState('');
  const [csvPreview, setCsvPreview] = useState<CsvPreview>();
  const [selectedMember, setSelectedMember] = useState<ReferralMember>();
  const [memberTab, setMemberTab] = useState('matches');
  const [editDraft, setEditDraft] = useState(emptyDraft);
  const [editActive, setEditActive] = useState(true);
  const [memberMatches, setMemberMatches] = useState<MemberAiMatch[]>([]);
  const [memberMatchTotal, setMemberMatchTotal] = useState(0);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberStatus, setMemberStatus] = useState('active');
  const [memberMinScore, setMemberMinScore] = useState('0.2');
  const [directorySearch, setDirectorySearch] = useState('');
  const [directoryWorkflowFilter, setDirectoryWorkflowFilter] = useState('all');
  const [directorySortBy, setDirectorySortBy] = useState('pending');
  const [directorySortDirection, setDirectorySortDirection] = useState('desc');

  const activeMembers = useMemo(() => members.filter((member) => member.active).length, [members]);
  const aiTotals = useMemo(() => members.reduce((totals, member) => {
    const counts = member.aiMatchCounts;
    if (!counts) return totals;
    totals.total += counts.total;
    totals.new += counts.new;
    totals.copied += counts.copied;
    totals.introduced += counts.introduced;
    totals.dismissed += counts.dismissed + counts.not_relevant;
    return totals;
  }, { total: 0, new: 0, copied: 0, introduced: 0, dismissed: 0 }), [members]);
  const visibleMembers = useMemo(() => {
    const scoreFor = (member: ReferralMember) => {
      const counts = member.aiMatchCounts;
      if (directorySortBy === 'potential') return counts?.total ?? 0;
      if (directorySortBy === 'introduced') return counts?.introduced ?? 0;
      if (directorySortBy === 'dismissed') return (counts?.dismissed ?? 0) + (counts?.not_relevant ?? 0);
      if (directorySortBy === 'copied') return counts?.copied ?? 0;
      if (directorySortBy === 'name') return member.name.toLocaleLowerCase();
      return counts?.new ?? 0;
    };
    const query = directorySearch.trim().toLocaleLowerCase();
    const filtered = members.filter((member) => {
      const counts = member.aiMatchCounts;
      if (directoryWorkflowFilter === 'active' && !member.active) return false;
      if (directoryWorkflowFilter === 'paused' && member.active) return false;
      if (directoryWorkflowFilter === 'pending' && (counts?.new ?? 0) <= 0) return false;
      if (directoryWorkflowFilter === 'potential' && (counts?.total ?? 0) <= 0) return false;
      if (directoryWorkflowFilter === 'introduced' && (counts?.introduced ?? 0) <= 0) return false;
      if (directoryWorkflowFilter === 'dismissed' && ((counts?.dismissed ?? 0) + (counts?.not_relevant ?? 0)) <= 0) return false;
      if (!query) return true;
      return [
        member.name,
        member.businessName,
        member.facebookName,
        member.category,
        member.keywords,
        member.servicesOffered,
        member.idealReferral,
      ].some((value) => String(value ?? '').toLocaleLowerCase().includes(query));
    });
    if (directorySortDirection === 'neutral') return filtered;
    return [...filtered].sort((a, b) => {
      const aValue = scoreFor(a);
      const bValue = scoreFor(b);
      const direction = directorySortDirection === 'asc' ? 1 : -1;
      if (typeof aValue === 'string' || typeof bValue === 'string') {
        return String(aValue).localeCompare(String(bValue)) * direction;
      }
      if (aValue === bValue) return a.name.localeCompare(b.name);
      return (aValue - bValue) * direction;
    });
  }, [directorySearch, directorySortBy, directorySortDirection, directoryWorkflowFilter, members]);

  const loadDirectory = () => apiGet<ReferralDirectoryResponse>('/referrals')
    .then((result) => {
      setMembers(result.members as ReferralMember[]);
      setCounts(result.matchCounts);
    })
    .catch((err) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => { void loadDirectory(); }, []);

  function openMember(member: ReferralMember) {
    setSelectedMember(member);
    setEditDraft({
      name: member.name,
      businessName: member.businessName ?? '',
      facebookName: member.facebookName ?? '',
      facebookProfileUrl: member.facebookProfileUrl ?? '',
      category: member.category,
      keywords: member.keywords,
      servicesOffered: member.servicesOffered ?? '',
      idealReferral: member.idealReferral ?? '',
      negativeKeywords: member.negativeKeywords ?? '',
      notes: member.notes ?? '',
    });
    setEditActive(member.active);
    setMemberTab('matches');
    void loadMemberMatches(member);
  }

  async function addMember() {
    setBusy('add');
    setMessage(undefined);
    setError(undefined);
    try {
      await apiSend('/referrals', 'POST', draft);
      setDraft(emptyDraft);
      setMessage('Referral member added.');
      await loadDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function toggleMember(member: ReferralMember) {
    setBusy(member.id);
    setError(undefined);
    try {
      await apiSend(`/referrals/${member.id}`, 'PATCH', { active: !member.active });
      await loadDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function saveSelectedMember() {
    if (!selectedMember) return;
    setBusy(`save:${selectedMember.id}`);
    setMessage(undefined);
    setError(undefined);
    try {
      const updated = await apiSend<ReferralMember>(`/referrals/${selectedMember.id}`, 'PATCH', { ...editDraft, active: editActive });
      setMessage(`${updated.name} updated.`);
      await loadDirectory();
      await loadMemberMatches(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function removeMember(member: ReferralMember) {
    if (!window.confirm(`Delete ${member.name} from the referral directory?`)) return;
    setBusy(member.id);
    setMessage(undefined);
    setError(undefined);
    try {
      await apiSend(`/referrals/${member.id}`, 'DELETE');
      setMessage('Referral member deleted.');
      await loadDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function generateMatches() {
    setBusy('generate');
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await apiSend<{ created: number; updated: number }>('/referrals/matches/generate', 'POST');
      setMessage(`Created ${result.created} keyword suggestions from saved posts; refreshed ${result.updated}. These are keyword matches, not confirmed AI referrals.`);
      await loadDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function downloadTemplate() {
    setBusy('template');
    setError(undefined);
    try {
      downloadText('referral-directory-template.csv', await apiGetText('/referrals/csv-template'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function handleCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setCsvPreview(undefined);
    setMessage(undefined);
    setError(undefined);
    try {
      setCsvPreview(await apiSend<CsvPreview>('/referrals/csv-preview', 'POST', { csv: text }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function importCsv(mode: 'skip' | 'overwrite') {
    if (!csvText) return;
    if (mode === 'overwrite' && csvPreview?.duplicates && !window.confirm(`Overwrite ${csvPreview.duplicates} duplicate member(s)?`)) return;
    setBusy(`csv:${mode}`);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await apiSend<{ created: number; updated: number; skipped: number }>('/referrals/csv-import', 'POST', { csv: csvText, mode });
      setMessage(`Imported CSV: created ${result.created}, updated ${result.updated}, skipped ${result.skipped}.`);
      setCsvText('');
      setCsvPreview(undefined);
      await loadDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function loadMemberMatches(member = selectedMember) {
    if (!member) return;
    setBusy(`member:${member.id}`);
    setError(undefined);
    try {
      const params = new URLSearchParams({ status: memberStatus, minScore: memberMinScore, pageSize: '50' });
      if (memberSearch.trim()) params.set('search', memberSearch.trim());
      const result = await apiGet<MemberMatchResponse>(`/referrals/${member.id}/ai-matches?${params.toString()}`);
      setSelectedMember(result.member);
      setMemberMatches(result.items);
      setMemberMatchTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  useEffect(() => {
    if (selectedMember) void loadMemberMatches(selectedMember);
  }, [memberStatus, memberMinScore]);

  async function updateAiMatch(match: MemberAiMatch, status: string) {
    if(status==='dismissed'){setDismissMatch(match);return;}
    setBusy(match.id);
    setError(undefined);
    try {
      await apiSend(`/referrals/ai-matches/${match.id}`, 'PATCH', { status });
      await loadMemberMatches();
      await loadDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function copyFacebookName(member: ReferralMember) {
    const value = member.facebookName || member.facebookProfileUrl || member.name;
    await navigator.clipboard.writeText(value);
    setMessage(`Copied ${value}.`);
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
        <Box>
          <Typography variant="overline" color="text.secondary">Referral engine</Typography>
          <Typography variant="h4">Referral Directory</Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="outlined" onClick={() => void downloadTemplate()} disabled={Boolean(busy)}>Download CSV Template</Button>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Button variant="contained" disabled={busy === 'generate' || members.length === 0} onClick={() => void generateMatches()}>
              {busy === 'generate' ? 'Matching...' : 'Generate Keyword Matches'}
            </Button>
            <HelpTip title="Runs the older keyword matcher against saved posts using each member's Keywords field. This is separate from Referral Queue matching and is useful as a fallback or comparison signal." />
          </Stack>
        </Stack>
      </Stack>
      {message && <Alert severity="success">{message}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
        <Card><CardContent><Typography color="text.secondary">Members</Typography><Typography variant="h4">{members.length}</Typography></CardContent></Card>
        <Card><CardContent><Typography color="text.secondary">Pending AI Matches</Typography><Typography variant="h4">{aiTotals.new}</Typography></CardContent></Card>
        <Card><CardContent><Typography color="text.secondary">Introduced</Typography><Typography variant="h4">{aiTotals.introduced}</Typography></CardContent></Card>
        <Card><CardContent><Typography color="text.secondary">Dismissed</Typography><Typography variant="h4">{aiTotals.dismissed}</Typography></CardContent></Card>
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label={`${activeMembers} active member(s)`} />
        <Chip label={`${aiTotals.total} AI potential match(es)`} />
        <Chip label={`${aiTotals.copied} copied`} />
        <Chip label={`${counts?.suggested ?? 0} keyword suggested`} />
        <HelpTip title="Pending AI Matches are new Ollama recommendations that still need review. Introduced and Dismissed are statuses you set while triaging a member's linked posts." />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.2fr 0.8fr' }, gap: 2 }}>
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography variant="h6">Add Member</Typography>
                <HelpTip title="Profiles are injected into the local AI prompt. Use concrete service terms and negative keywords so the model has enough evidence to avoid weak matches." />
              </Stack>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
                <TextField size="small" label="Name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                <TextField size="small" label="Business" value={draft.businessName} onChange={(event) => setDraft({ ...draft, businessName: event.target.value })} />
                <TextField size="small" label="Category" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
                <TextField size="small" label="Facebook name" value={draft.facebookName} onChange={(event) => setDraft({ ...draft, facebookName: event.target.value })} />
                <TextField size="small" label="Facebook profile URL" value={draft.facebookProfileUrl} onChange={(event) => setDraft({ ...draft, facebookProfileUrl: event.target.value })} />
                <TextField size="small" label="Keywords" value={draft.keywords} onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} />
                <TextField size="small" label="Services offered" value={draft.servicesOffered} onChange={(event) => setDraft({ ...draft, servicesOffered: event.target.value })} />
                <TextField size="small" label="Ideal referral" value={draft.idealReferral} onChange={(event) => setDraft({ ...draft, idealReferral: event.target.value })} />
                <TextField size="small" label="Negative keywords" value={draft.negativeKeywords} onChange={(event) => setDraft({ ...draft, negativeKeywords: event.target.value })} />
              </Box>
              <TextField size="small" label="Notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
              <Button variant="contained" disabled={busy === 'add'} onClick={() => void addMember()} sx={{ alignSelf: 'flex-start' }}>{busy === 'add' ? 'Adding...' : 'Add Member'}</Button>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography variant="h6">CSV Import</Typography>
                <HelpTip title="Download the template, fill one row per referral member, then upload it. Duplicate detection uses Facebook name when present, otherwise name plus business." />
              </Stack>
              <Button variant="outlined" component="label">
                Choose CSV
                <input hidden type="file" accept=".csv,text/csv" onChange={(event) => void handleCsvFile(event)} />
              </Button>
              {csvPreview && (
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip label={`${csvPreview.total} rows`} />
                    <Chip label={`${csvPreview.valid} valid`} color="success" />
                    <Chip label={`${csvPreview.duplicates} duplicates`} color={csvPreview.duplicates ? 'warning' : 'default'} />
                    <Chip label={`${csvPreview.invalid} invalid`} color={csvPreview.invalid ? 'error' : 'default'} />
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" disabled={Boolean(busy)} onClick={() => void importCsv('skip')}>Import New Only</Button>
                    <Button color="warning" disabled={Boolean(busy) || !csvPreview.duplicates} onClick={() => void importCsv('overwrite')}>Overwrite Duplicates</Button>
                  </Stack>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Box>

      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="h6">Members</Typography>
            <HelpTip title="Use these controls to prioritise members by what needs action next. Pending means AI-linked posts that have not yet been copied, introduced, or dismissed." />
          </Stack>
          <Typography color="text.secondary">{visibleMembers.length} shown</Typography>
        </Stack>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField size="small" label="Search members" value={directorySearch} onChange={(event) => setDirectorySearch(event.target.value)} sx={{ width: 260 }} />
              <TextField select size="small" label="Show" value={directoryWorkflowFilter} onChange={(event) => setDirectoryWorkflowFilter(event.target.value)} sx={{ width: 210 }}>
                <MenuItem value="all">All members</MenuItem>
                <MenuItem value="pending">Has pending matches</MenuItem>
                <MenuItem value="potential">Has any potential</MenuItem>
                <MenuItem value="introduced">Has introduced</MenuItem>
                <MenuItem value="dismissed">Has dismissed</MenuItem>
                <MenuItem value="active">Active only</MenuItem>
                <MenuItem value="paused">Paused only</MenuItem>
              </TextField>
              <TextField select size="small" label="Order by" value={directorySortBy} onChange={(event) => setDirectorySortBy(event.target.value)} sx={{ width: 190 }}>
                <MenuItem value="pending">Pending matches</MenuItem>
                <MenuItem value="potential">Potential matches</MenuItem>
                <MenuItem value="introduced">Introduced</MenuItem>
                <MenuItem value="copied">Copied</MenuItem>
                <MenuItem value="dismissed">Dismissed</MenuItem>
                <MenuItem value="name">Name</MenuItem>
              </TextField>
              <TextField select size="small" label="Direction" value={directorySortDirection} onChange={(event) => setDirectorySortDirection(event.target.value)} sx={{ width: 170 }}>
                <MenuItem value="desc">Descending</MenuItem>
                <MenuItem value="asc">Ascending</MenuItem>
                <MenuItem value="neutral">Neutral</MenuItem>
              </TextField>
              <Button
                onClick={() => {
                  setDirectorySearch('');
                  setDirectoryWorkflowFilter('all');
                  setDirectorySortBy('pending');
                  setDirectorySortDirection('desc');
                }}
              >
                Reset
              </Button>
            </Stack>
          </CardContent>
        </Card>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip label={`${visibleMembers.filter((member) => (member.aiMatchCounts?.new ?? 0) > 0).length} with pending`} color="warning" />
          <Chip label={`${visibleMembers.filter((member) => (member.aiMatchCounts?.total ?? 0) > 0).length} with potentials`} />
          <Chip label={`${visibleMembers.filter((member) => (member.aiMatchCounts?.introduced ?? 0) > 0).length} introduced`} color="success" />
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 2 }}>
          {visibleMembers.length === 0 ? (
            <Card>
              <CardContent>
                <Typography color="text.secondary">No members match these filters.</Typography>
              </CardContent>
            </Card>
          ) : visibleMembers.map((member) => (
            <Card key={member.id} sx={{ cursor: 'pointer' }} onClick={() => openMember(member)}>
              <CardContent>
                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Box>
                      <Typography variant="h6">{member.name}</Typography>
                      <Typography color="text.secondary">{member.businessName || member.category}</Typography>
                    </Box>
                    <Switch checked={member.active} disabled={busy === member.id} onClick={(event) => event.stopPropagation()} onChange={() => void toggleMember(member)} />
                  </Stack>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={member.category} />
                    {member.facebookName && <Chip size="small" label={member.facebookName} />}
                    <Chip size="small" label={member.active ? 'Active' : 'Paused'} color={member.active ? 'success' : 'default'} />
                  </Stack>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={`${member.aiMatchCounts?.total ?? 0} potential`} />
                    <Chip size="small" label={`${member.aiMatchCounts?.new ?? 0} pending`} color={(member.aiMatchCounts?.new ?? 0) > 0 ? 'warning' : 'default'} />
                    <Chip size="small" label={`${member.aiMatchCounts?.introduced ?? 0} introduced`} color={(member.aiMatchCounts?.introduced ?? 0) > 0 ? 'success' : 'default'} />
                    <Chip size="small" label={`${(member.aiMatchCounts?.dismissed ?? 0) + (member.aiMatchCounts?.not_relevant ?? 0)} dismissed`} />
                  </Stack>
                  <Typography color="text.secondary" sx={{ minHeight: 44 }}>{member.idealReferral || member.servicesOffered || member.keywords}</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" onClick={(event) => { event.stopPropagation(); openMember(member); }}>Review Matches</Button>
                    <Button size="small" onClick={(event) => { event.stopPropagation(); void copyFacebookName(member); }}>Copy FB</Button>
                    <Button size="small" color="error" disabled={busy === member.id} onClick={(event) => { event.stopPropagation(); void removeMember(member); }}>Delete</Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Stack>

      <Dialog open={Boolean(selectedMember)} onClose={() => setSelectedMember(undefined)} maxWidth="lg" fullWidth>
        <DialogTitle>{selectedMember?.name} profile and referrals</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {selectedMember && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={selectedMember.category} />
                {selectedMember.facebookName && <Chip label={selectedMember.facebookName} />}
                <Button size="small" variant="outlined" onClick={() => void copyFacebookName(selectedMember)}>Copy Facebook Name</Button>
                {selectedMember.facebookProfileUrl && <Button size="small" href={selectedMember.facebookProfileUrl} target="_blank">Open Profile</Button>}
              </Stack>
            )}

            <Tabs value={memberTab} onChange={(_, value) => setMemberTab(value)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tab value="matches" label={`Linked Matches (${memberMatchTotal})`} />
              <Tab value="profile" label="Member Profile" />
              <Tab value="feedback" label="Matching corrections" />
            </Tabs>

            {memberTab==='feedback'&&selectedMember&&<MemberFeedbackPanel memberId={selectedMember.id} refreshKey={feedbackRefresh}/>}
            {memberTab === 'profile' && (
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={2}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="h6">Member Profile</Typography>
                        <HelpTip title="These fields are used by AI matching. Add specific services, ideal referral language, keywords, and negative keywords to improve future recommendations." />
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography color="text.secondary">{editActive ? 'Active' : 'Paused'}</Typography>
                        <Switch checked={editActive} disabled={Boolean(busy)} onChange={(event) => setEditActive(event.target.checked)} />
                        <Button variant="contained" disabled={busy?.startsWith('save:')} onClick={() => void saveSelectedMember()}>
                          {busy?.startsWith('save:') ? 'Saving...' : 'Save Profile'}
                        </Button>
                      </Stack>
                    </Stack>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 1.5 }}>
                      <TextField size="small" label="Name" value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} />
                      <TextField size="small" label="Business" value={editDraft.businessName} onChange={(event) => setEditDraft({ ...editDraft, businessName: event.target.value })} />
                      <TextField size="small" label="Category" value={editDraft.category} onChange={(event) => setEditDraft({ ...editDraft, category: event.target.value })} />
                      <TextField size="small" label="Facebook name" value={editDraft.facebookName} onChange={(event) => setEditDraft({ ...editDraft, facebookName: event.target.value })} />
                      <TextField size="small" label="Facebook profile URL" value={editDraft.facebookProfileUrl} onChange={(event) => setEditDraft({ ...editDraft, facebookProfileUrl: event.target.value })} />
                      <TextField size="small" label="Keywords" value={editDraft.keywords} onChange={(event) => setEditDraft({ ...editDraft, keywords: event.target.value })} />
                    </Box>
                    <TextField size="small" label="Services offered" value={editDraft.servicesOffered} onChange={(event) => setEditDraft({ ...editDraft, servicesOffered: event.target.value })} multiline minRows={2} />
                    <TextField size="small" label="Ideal referral" value={editDraft.idealReferral} onChange={(event) => setEditDraft({ ...editDraft, idealReferral: event.target.value })} multiline minRows={2} />
                    <TextField size="small" label="Negative keywords" value={editDraft.negativeKeywords} onChange={(event) => setEditDraft({ ...editDraft, negativeKeywords: event.target.value })} multiline minRows={2} />
                    <TextField size="small" label="Notes" value={editDraft.notes} onChange={(event) => setEditDraft({ ...editDraft, notes: event.target.value })} multiline minRows={2} />
                  </Stack>
                </CardContent>
              </Card>
            )}

            {memberTab === 'matches' && (
              <Stack spacing={2}>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  <TextField size="small" label="Search posts" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadMemberMatches(); }} />
                  <TextField select size="small" label="Status" value={memberStatus} onChange={(event) => setMemberStatus(event.target.value)} sx={{ width: 200 }}>
                    <MenuItem value="active">Active (hide dismissed)</MenuItem>
                    <MenuItem value="all">All</MenuItem>
                    <MenuItem value="new">New</MenuItem>
                    <MenuItem value="copied">Copied</MenuItem>
                    <MenuItem value="introduced">Introduced</MenuItem>
                    <MenuItem value="dismissed">Dismissed</MenuItem>
                    <MenuItem value="not_relevant">Not relevant</MenuItem>
                  </TextField>
                  <TextField select size="small" label="Min score" value={memberMinScore} onChange={(event) => setMemberMinScore(event.target.value)} sx={{ width: 150 }}>
                    <MenuItem value="0">Any</MenuItem>
                    <MenuItem value="0.2">20%+</MenuItem>
                    <MenuItem value="0.5">50%+</MenuItem>
                    <MenuItem value="0.8">80%+</MenuItem>
                  </TextField>
                  <Button variant="contained" onClick={() => void loadMemberMatches()}>Search</Button>
                </Stack>
                <Typography color="text.secondary">{memberMatchTotal} linked post(s)</Typography>
                {memberMatches.map((match) => (
                  <Card key={match.id} variant="outlined">
                    <CardContent>
                      <Stack spacing={1.25}>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Chip size="small" label={match.scorePercent} color="success" />
                          <Chip size="small" label={match.status} />
                          {match.assessment.intent && <Chip size="small" label={match.assessment.intent} />}
                          {match.assessment.post.group?.friendlyName && <Chip size="small" label={match.assessment.post.group.friendlyName} />}
                          {match.assessment.post.hasRealPermalink === false && <Chip size="small" color="warning" label="No direct URL" />}
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {match.assessment.post.originalPostedAt
                            ? `Posted: ${new Date(match.assessment.post.originalPostedAt).toLocaleString('en-GB')}`
                            : 'Posted: date unavailable'}
                          {' · '}First collected: {new Date(match.assessment.post.firstDiscoveredAt).toLocaleString('en-GB')}
                        </Typography>
                        <Typography>{match.assessment.post.latestCapturedText || match.assessment.summary || 'No post text.'}</Typography>
                        {match.note&&<Alert severity="info">Your review note: {match.note}</Alert>}
                        {match.reason && <Typography color="text.secondary">{match.reason}</Typography>}
                        {match.suggestedIntro && <Alert severity="info">{match.suggestedIntro}</Alert>}
                        <PostLinkActions
                          post={match.assessment.post}
                          showStoredUrl={false}
                          onUpdated={(updated) => {
                            setMemberMatches((current) => current.map((row) => (
                              row.id === match.id
                                ? {
                                  ...row,
                                  assessment: {
                                    ...row.assessment,
                                    post: {
                                      ...row.assessment.post,
                                      canonicalPostUrl: updated.canonicalPostUrl,
                                      hasRealPermalink: updated.hasRealPermalink,
                                      searchPostUrl: updated.searchPostUrl,
                                      openPostUrl: updated.openPostUrl,
                                      searchExcerpt: updated.searchExcerpt,
                                    },
                                  },
                                }
                                : row
                            )));
                            setMessage('Direct Facebook post URL saved.');
                          }}
                        />
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button size="small" onClick={() => selectedMember && void copyFacebookName(selectedMember)}>Copy FB</Button>
                          <Button size="small" onClick={() => void updateAiMatch(match, 'copied')}>Copied</Button>
                          <Button size="small" color="success" onClick={() => void updateAiMatch(match, 'introduced')}>Introduced</Button>
                          <Button size="small" color="inherit" onClick={() => void updateAiMatch(match, 'dismissed')}>Dismiss</Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>
        </DialogContent>
      </Dialog>
      {dismissMatch&&selectedMember&&<DismissReferralDialog key={dismissMatch.id} matchId={dismissMatch.id} memberName={selectedMember.name} postText={dismissMatch.assessment.post.latestCapturedText??dismissMatch.assessment.summary??''} modelReason={dismissMatch.reason} onClose={()=>setDismissMatch(undefined)} onSaved={async(learn)=>{setDismissMatch(undefined);setFeedbackRefresh(value=>value+1);setMessage(learn?'Match dismissed and correction saved for future AI checks.':'Match dismissed without adding a matching correction.');await loadMemberMatches();await loadDirectory();}}/>}
    </Stack>
  );
}
