/**
 * Health Posts Controller
 * Manages uploading, retrieving, liking, and downloading doctor posts.
 */

import {
  addHealthPost,
  getAllHealthPosts,
  incrementPostLikes,
  incrementPostDownloads,
  findUserByEmail
} from '../config/db.js';

/**
 * Upload a new health tip / poster post (Doctor only)
 */
export const uploadPost = async (req, res) => {
  const { doctorEmail, bannerImage, heading, description } = req.body;

  if (!doctorEmail || !bannerImage || !heading || !description) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: doctorEmail, bannerImage, heading, description are all required.'
    });
  }

  try {
    // Fetch doctor info to populate post author metadata
    const doctor = await findUserByEmail(doctorEmail);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({
        success: false,
        error: `Doctor with email ${doctorEmail} not found.`
      });
    }

    const doctorProfile = doctor.profileData || {};
    const doctorName = doctor.name || 'Doctor';
    const doctorSpecialty = doctorProfile.specialization || 'General Specialist';
    const doctorAvatar = doctorProfile.photoUrl || '';

    const postId = `post_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const postData = {
      postId,
      doctorEmail,
      doctorName,
      doctorSpecialty,
      doctorAvatar,
      bannerImage,
      heading,
      description
    };

    await addHealthPost(postData);

    console.log(`📌 [Post] Doctor ${doctorEmail} uploaded new poster: ${heading}`);

    res.status(201).json({
      success: true,
      postId,
      message: 'Health Byte post uploaded successfully!'
    });

  } catch (err) {
    console.error('Error uploading post:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to upload post: ' + err.message
    });
  }
};

/**
 * Get all health tip posts
 */
export const getPosts = async (req, res) => {
  try {
    const posts = await getAllHealthPosts();
    res.json({
      success: true,
      posts
    });
  } catch (err) {
    console.error('Error fetching posts:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch posts: ' + err.message
    });
  }
};

/**
 * Increment like counter for a post
 */
export const likePost = async (req, res) => {
  const { postId } = req.params;
  if (!postId) {
    return res.status(400).json({
      success: false,
      error: 'Post ID is required'
    });
  }

  try {
    const updated = await incrementPostLikes(postId);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }
    res.json({
      success: true,
      likes: updated.likes
    });
  } catch (err) {
    console.error('Error liking post:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to like post: ' + err.message
    });
  }
};

/**
 * Increment download counter for a post
 */
export const downloadPost = async (req, res) => {
  const { postId } = req.params;
  if (!postId) {
    return res.status(400).json({
      success: false,
      error: 'Post ID is required'
    });
  }

  try {
    const updated = await incrementPostDownloads(postId);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }
    res.json({
      success: true,
      downloads: updated.downloads
    });
  } catch (err) {
    console.error('Error logging download:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to log download: ' + err.message
    });
  }
};
