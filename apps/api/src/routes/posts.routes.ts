import { Router } from 'express';
import { deletePost, listPosts } from '../services/posts.service.js';

export const postsRouter = Router();

postsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await listPosts(Number(req.query.page ?? 1), Number(req.query.pageSize ?? 25)));
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
