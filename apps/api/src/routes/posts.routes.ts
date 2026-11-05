import { Router } from 'express';
import {
  deleteIgnoredPosts,
  deletePost,
  getPostDetail,
  listPosts,
  PostUrlCollisionError,
  updatePostCanonicalUrl,
  updatePostReviewStatus,
} from '../services/posts.service.js';

export const postsRouter = Router();

postsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await listPosts({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 25),
      reviewStatus: typeof req.query.reviewStatus === 'string' ? req.query.reviewStatus : undefined,
      groupId: typeof req.query.groupId === 'string' ? req.query.groupId : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      minConfidence: typeof req.query.minConfidence === 'string' ? Number(req.query.minConfidence) : undefined,
      aiReferralOnly: req.query.aiReferralOnly === 'true',
      aiIntent: typeof req.query.aiIntent === 'string' ? req.query.aiIntent : undefined,
      aiMemberId: typeof req.query.aiMemberId === 'string' ? req.query.aiMemberId : undefined,
    }));
  } catch (error) {
    next(error);
  }
});

postsRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await getPostDetail(req.params.id));
  } catch (error) {
    next(error);
  }
});

postsRouter.patch('/:id/review', async (req, res, next) => {
  try {
    res.json(await updatePostReviewStatus(req.params.id, req.body.reviewStatus));
  } catch (error) {
    next(error);
  }
});

postsRouter.patch('/:id/canonical-url', async (req, res, next) => {
  try {
    const url = typeof req.body?.canonicalPostUrl === 'string' ? req.body.canonicalPostUrl : '';
    res.json(await updatePostCanonicalUrl(req.params.id, url));
  } catch (error) {
    if (error instanceof PostUrlCollisionError) {
      res.status(409).json({
        error: error.message,
        conflictingPostId: error.conflictingPostId,
        conflictingFriendlyLabel: error.conflictingFriendlyLabel,
      });
      return;
    }
    next(error);
  }
});

postsRouter.delete('/ignored/all', async (_req, res, next) => {
  try {
    res.json(await deleteIgnoredPosts());
  } catch (error) {
    next(error);
  }
});

postsRouter.delete('/:id', async (req, res, next) => {
  try {
    res.json(await deletePost(req.params.id));
  } catch (error) {
    next(error);
  }
});
