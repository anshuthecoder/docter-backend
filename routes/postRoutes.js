/**
 * Health Posts Routes
 * Maps URL endpoints to post controller actions.
 */

import { Router } from 'express';
import {
  uploadPost,
  getPosts,
  likePost,
  downloadPost
} from '../controllers/postController.js';

const router = Router();

// POST /api/posts/upload - Doctor uploads a new post
router.post('/upload', uploadPost);

// GET /api/posts - Fetch all posts (doctor & patient view)
router.get('/', getPosts);

// POST /api/posts/:postId/like - Increments likes for a post
router.post('/:postId/like', likePost);

// POST /api/posts/:postId/download - Logs downloads for a post
router.post('/:postId/download', downloadPost);

export default router;
