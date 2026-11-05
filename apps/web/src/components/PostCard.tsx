import { useState } from 'react';
import { reviewStatuses } from '@local-group-monitor/shared';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { PostLinkActions, type PostLinkFields } from './PostLinkActions';

export interface PostCardAssessment {
  id: string;
  status: string;
  intent?: string | null;
  isReferralOpportunity?: boolean | null;
  confidence?: number | null;
  summary?: string | null;
  errorMessage?: string | null;
  prefilterMatchedPhrase?: string | null;
  prefilterBypassed?: boolean;
  prefilterEnabled?: boolean;
  memberMatches?: Array<{
    id: string;
    scorePercent: string;
    reason?: string | null;
    suggestedIntro?: string | null;
    referralMember?: {
      id: string;
      name: string;
      category: string;
      businessName?: string | null;
      facebookName?: string | null;
      facebookProfileUrl?: string | null;
    };
  }>;
}

export interface PostCardPost extends PostLinkFields {
  authorName?: string | null;
  latestCapturedText?: string | null;
  originalTimestampLabel?: string | null;
  originalPostedAt?: string | null;
  firstDiscoveredAt: string;
  reviewStatus: string;
  analysisStatus: string;
  hasImages: boolean;
  imageCount: number;
  extractionConfidence?: number | null;
  group?: { friendlyName: string };
  aiAssessments?: PostCardAssessment[];
}

function confidenceChipTooltip(confidence: number, hasRealPermalink?: boolean) {
  const percent = Math.round(confidence * 100);
  if (hasRealPermalink === false || confidence <= 0.5) {
    return `Extraction confidence ${percent}%.\n\nLower because no direct Facebook post URL was found — this post uses a local fallback link and a Search Facebook workaround instead.`;
  }
  if (confidence >= 0.9) {
    return `Extraction confidence ${percent}%.\n\nA direct Facebook post URL and author were captured cleanly.`;
  }
  return `Extraction confidence ${percent}%.\n\nA direct Facebook post URL was found. Slightly lower scores usually mean some fields (like author) were incomplete.`;
}

function aiChipTooltip(assessment: PostCardAssessment) {
  const lines: string[] = [];
  if (assessment.status === 'skipped') {
    lines.push(assessment.summary || assessment.errorMessage || 'Skipped by AI prefilter.');
    if (assessment.errorMessage === 'prefilter_no_match' || /prefilter_no_match|no pre-filter/i.test(`${assessment.summary ?? ''} ${assessment.errorMessage ?? ''}`)) {
      lines.push('No trigger phrase matched.');
    }
  } else if (assessment.status === 'failed') {
    lines.push(assessment.errorMessage || assessment.summary || 'AI assessment failed.');
  } else if (assessment.status === 'completed') {
    if (assessment.summary) lines.push(assessment.summary);
    if (assessment.prefilterMatchedPhrase) {
      lines.push(`Triggered by phrase: “${assessment.prefilterMatchedPhrase}”`);
    } else if (assessment.prefilterBypassed) {
      lines.push('Prefilter was bypassed for this run.');
    } else if (assessment.prefilterEnabled === false) {
      lines.push('Prefilter was disabled when this was queued.');
    }
  } else {
    lines.push(`AI status: ${assessment.status}.`);
    if (assessment.prefilterMatchedPhrase) {
      lines.push(`Triggered by phrase: “${assessment.prefilterMatchedPhrase}”`);
    }
  }
  return lines.filter(Boolean).join('\n\n');
}

function aiPanelSeverity(assessment: PostCardAssessment): 'error' | 'warning' | 'success' | 'info' {
  if (assessment.status === 'failed') return 'error';
  if (assessment.status === 'skipped') return 'warning';
  if (assessment.isReferralOpportunity) return 'success';
  return 'info';
}

interface PostCardProps {
  post: PostCardPost;
  busy?: string;
  onOpenRaw: (post: PostCardPost) => void;
  onRunAi: (post: PostCardPost, force: boolean) => void;
  onUpdateReview: (post: PostCardPost, reviewStatus: typeof reviewStatuses[number]) => void;
  onRemove: (post: PostCardPost) => void;
  onLinkUpdated: (postId: string, updated: PostLinkFields) => void;
}

export function PostCard({
  post,
  busy,
  onOpenRaw,
  onRunAi,
  onUpdateReview,
  onRemove,
  onLinkUpdated,
}: PostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const latestAi = post.aiAssessments?.[0];
  const body = post.latestCapturedText || 'No text captured.';
  const longBody = body.length > 320 || body.split('\n').length > 5;

  return (
    <Card>
      <CardContent>
        <Stack spacing={1.75}>
          {/* Row 1 — status only */}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={post.group?.friendlyName ?? 'Group'} />
            {post.authorName && <Chip size="small" label={post.authorName} />}
            <Chip
              size="small"
              label={post.reviewStatus}
              color={
                post.reviewStatus === 'useful'
                  ? 'success'
                  : post.reviewStatus === 'ignored'
                    ? 'default'
                    : post.reviewStatus === 'requires_review'
                      ? 'warning'
                      : 'primary'
              }
            />
            {!latestAi && <Chip size="small" label={post.analysisStatus} />}
            {latestAi && (
              <Tooltip
                title={<Typography sx={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{aiChipTooltip(latestAi)}</Typography>}
                arrow
                enterDelay={200}
              >
                <Chip
                  size="small"
                  label={`AI: ${latestAi.status === 'completed' ? latestAi.intent ?? 'done' : latestAi.status}`}
                  color={latestAi.isReferralOpportunity ? 'success' : latestAi.status === 'failed' ? 'error' : 'default'}
                />
              </Tooltip>
            )}
            {post.hasRealPermalink === false && <Chip size="small" color="warning" label="No direct URL" />}
            {post.hasImages && post.imageCount > 0 && (
              <Chip size="small" label={`${post.imageCount} image(s)`} />
            )}
            {typeof post.extractionConfidence === 'number' && (
              <Tooltip
                title={<Typography sx={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{confidenceChipTooltip(post.extractionConfidence, post.hasRealPermalink)}</Typography>}
                arrow
                enterDelay={200}
              >
                <Chip size="small" label={`Confidence ${Math.round(post.extractionConfidence * 100)}%`} />
              </Tooltip>
            )}
            {post.originalTimestampLabel && <Chip size="small" variant="outlined" label={post.originalTimestampLabel} />}
          </Stack>

          {/* Row 2 — post body */}
          <Box>
            <Typography
              sx={
                !expanded && longBody
                  ? {
                    display: '-webkit-box',
                    WebkitLineClamp: 5,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    whiteSpace: 'pre-wrap',
                  }
                  : { whiteSpace: 'pre-wrap' }
              }
            >
              {body}
            </Typography>
            {longBody && (
              <Button size="small" onClick={() => setExpanded((value) => !value)} sx={{ mt: 0.5, px: 0 }}>
                {expanded ? 'Show less' : 'Show more'}
              </Button>
            )}
          </Box>

          {/* Row 3 — AI insight panel */}
          {latestAi && (latestAi.summary || latestAi.errorMessage || (latestAi.memberMatches && latestAi.memberMatches.length > 0)) && (
            <Alert
              severity={aiPanelSeverity(latestAi)}
              sx={{ '& .MuiAlert-message': { width: '100%' } }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                {latestAi.status === 'skipped' ? 'Skip reason' : latestAi.status === 'failed' ? 'Error' : 'AI summary'}
              </Typography>
              {(latestAi.summary || latestAi.errorMessage) && (
                <Typography sx={{ mb: latestAi.memberMatches?.length ? 1 : 0 }}>
                  {latestAi.summary || latestAi.errorMessage}
                </Typography>
              )}
              {latestAi.memberMatches && latestAi.memberMatches.length > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {latestAi.memberMatches.map((match) => (
                    <Chip key={match.id} size="small" label={`${match.referralMember?.name ?? 'Member'} ${match.scorePercent}`} />
                  ))}
                </Stack>
              )}
            </Alert>
          )}

          {/* Row 4 — footer */}
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', md: 'flex-end' }}
            sx={{ pt: 0.5, borderTop: 1, borderColor: 'divider' }}
          >
            <Stack spacing={0.75} sx={{ minWidth: 0, flex: 1 }}>
              <PostLinkActions
                post={post}
                variant="footer"
                onUpdated={(updated) => onLinkUpdated(post.id, updated)}
              />
              <Typography variant="body2" color="text.secondary">
                Posted {post.originalPostedAt ? new Date(post.originalPostedAt).toLocaleString() : 'Unknown'}
                {' · '}
                Discovered {new Date(post.firstDiscoveredAt).toLocaleString()}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center" justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
              <Button size="small" disabled={Boolean(busy)} onClick={() => onUpdateReview(post, 'useful')}>
                Useful
              </Button>
              <Button size="small" color="warning" disabled={Boolean(busy)} onClick={() => onUpdateReview(post, 'requires_review')}>
                Review
              </Button>
              <Button size="small" color="inherit" disabled={Boolean(busy)} onClick={() => onUpdateReview(post, 'ignored')}>
                Ignore
              </Button>
              <IconButton
                size="small"
                aria-label="More actions"
                disabled={Boolean(busy)}
                onClick={(event) => setMenuAnchor(event.currentTarget)}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
              <Menu
                anchorEl={menuAnchor}
                open={Boolean(menuAnchor)}
                onClose={() => setMenuAnchor(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              >
                <MenuItem
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setMenuAnchor(null);
                    onOpenRaw(post);
                  }}
                >
                  {busy === `${post.id}:raw` ? 'Loading raw…' : 'Raw Data'}
                </MenuItem>
                <MenuItem
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setMenuAnchor(null);
                    onRunAi(post, Boolean(post.aiAssessments?.length));
                  }}
                >
                  {busy === `${post.id}:ai` ? 'Running…' : post.aiAssessments?.length ? 'Rerun AI' : 'Run AI'}
                </MenuItem>
                <MenuItem
                  disabled={busy === post.id}
                  onClick={() => {
                    setMenuAnchor(null);
                    onRemove(post);
                  }}
                  sx={{ color: 'error.main' }}
                >
                  {busy === post.id ? 'Deleting…' : 'Delete'}
                </MenuItem>
              </Menu>
            </Stack>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
