const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { 
  createUser, 
  getUser, 
  updateUser, 
  createSession, 
  deleteSession,
  getUserNotes, addUserNote, updateUserNote, deleteUserNote,
  getUserSavedFilters, addUserSavedFilter, updateUserSavedFilter, deleteUserSavedFilter,
  getUserPinnedItems, addUserPinnedItem, removeUserPinnedItem
} = require('../utils/database.cjs');
const { getUserProfile } = require('../utils/github.cjs');
const { asyncHandler } = require('../middleware/errorHandler.cjs');

const router = express.Router();

// GitHub OAuth configuration
// GitHub OAuth configuration - read from environment at runtime
const getGitHubConfig = () => ({
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackUrl: process.env.GITHUB_CALLBACK_URL
});

// Store OAuth states in memory (in production, use Redis or database)
const oauthStates = new Map();

// Generate GitHub OAuth URL
router.get('/github/url', (req, res) => {
  const state = uuidv4(); // Generate random state for security
  const config = getGitHubConfig();
  
  // Store state with timestamp for cleanup
  oauthStates.set(state, {
    timestamp: Date.now(),
    used: false
  });
  
  // Clean up old states (older than 10 minutes)
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, value] of oauthStates.entries()) {
    if (value.timestamp < tenMinutesAgo) {
      oauthStates.delete(key);
    }
  }
  
  const githubAuthUrl = `https://github.com/login/oauth/authorize?` +
    `client_id=${config.clientId}&` +
    `redirect_uri=${encodeURIComponent(config.callbackUrl)}&` +
    `scope=repo,user,read:org,repo:status,repo_deployment&` +
    `prompt=select_account&` +
    `state=${state}`;

  res.json({
    authUrl: githubAuthUrl,
    state: state
  });
});

// GitHub OAuth callback
router.get('/github/callback', asyncHandler(async (req, res) => {
  console.log('🔵 OAuth callback started:', new Date().toISOString())
  const { code, state } = req.query;

  // Validate state parameter
  if (state && oauthStates.has(state)) {
    const stateData = oauthStates.get(state);
    if (stateData.used) {
      console.log('❌ OAuth state already used:', state);
      const frontendUrl = process.env.NODE_ENV === 'production'
        ? 'https://your-frontend-domain.com'
        : 'http://localhost:3000';
      const redirectUrl = `${frontendUrl}/?auth_error=${encodeURIComponent('OAuth State Error')}&auth_message=${encodeURIComponent('OAuth state already used. Please try again.')}`;
      return res.redirect(redirectUrl);
    }
    // Mark state as used
    oauthStates.set(state, { ...stateData, used: true });
  } else if (state) {
    console.log('❌ Invalid OAuth state:', state);
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? 'https://your-frontend-domain.com'
      : 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/?auth_error=${encodeURIComponent('OAuth State Error')}&auth_message=${encodeURIComponent('Invalid OAuth state. Please try again.')}`;
    return res.redirect(redirectUrl);
  }

  if (!code) {
    console.log('❌ No authorization code received')
    
    // Redirect to frontend with error parameters
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? 'https://your-frontend-domain.com'
      : 'http://localhost:3000';
    
    const redirectUrl = `${frontendUrl}/?auth_error=${encodeURIComponent('Authorization code required')}&auth_message=${encodeURIComponent('GitHub authorization code is missing')}`;
    
    console.log('❌ Redirecting to frontend with missing code error:', redirectUrl);
    return res.redirect(redirectUrl);
  }

  console.log('✅ Authorization code received, starting token exchange...')
  try {
    const config = getGitHubConfig();
    
    console.log('🔄 Exchanging code for access token...')
    console.log('📤 Sending to GitHub:', {
      client_id: config.clientId,
      code: code ? `${code.substring(0, 10)}...` : 'undefined',
      redirect_uri: config.callbackUrl
    })
    
    // Exchange code for access token
    const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: code,
      redirect_uri: config.callbackUrl
    }, {
      headers: {
        'Accept': 'application/json'
      }
    });
    console.log('✅ Token exchange completed')

    const { access_token, error, error_description } = tokenResponse.data;

    console.log('🔍 Token response data:', { 
      hasAccessToken: !!access_token, 
      error, 
      error_description,
      responseStatus: tokenResponse.status 
    })

    if (error) {
      console.error('❌ GitHub OAuth error:', { error, error_description })
      
      // Redirect to frontend with error parameters for OAuth errors
      const frontendUrl = process.env.NODE_ENV === 'production'
        ? 'https://your-frontend-domain.com'
        : 'http://localhost:3000';
      
      let errorMessage = error_description || 'Failed to exchange code for access token';
      
      // Provide more specific error messages for common OAuth errors
      if (error === 'bad_verification_code') {
        errorMessage = 'The OAuth code has expired or was already used. This often happens when the server restarts during authentication. Please try logging in again.';
      } else if (error === 'invalid_client') {
        errorMessage = 'OAuth client configuration error. Please contact support.';
      } else if (error === 'redirect_uri_mismatch') {
        errorMessage = 'OAuth redirect URI mismatch. Please contact support.';
      }
      
      const redirectUrl = `${frontendUrl}/?auth_error=${encodeURIComponent('GitHub OAuth Error')}&auth_message=${encodeURIComponent(errorMessage)}`;
      
      console.log('❌ Redirecting to frontend with OAuth error:', redirectUrl);
      return res.redirect(redirectUrl);
    }

    if (!access_token) {
      console.error('❌ No access token received from GitHub')
      
      // Redirect to frontend with error parameters
      const frontendUrl = process.env.NODE_ENV === 'production'
        ? 'https://your-frontend-domain.com'
        : 'http://localhost:3000';
      
      const redirectUrl = `${frontendUrl}/?auth_error=${encodeURIComponent('Access token missing')}&auth_message=${encodeURIComponent('GitHub did not return an access token')}`;
      
      console.log('❌ Redirecting to frontend with access token error:', redirectUrl);
      return res.redirect(redirectUrl);
    }

    console.log('🔄 Getting user profile from GitHub...')
    // Get user profile from GitHub
    const userProfile = await getUserProfile(access_token);
    console.log('✅ User profile received:', userProfile.login)

    console.log('🔄 Checking user in database...')
    // Create or update user in database
    let user = await getUser(userProfile.id);
    
    if (!user) {
      console.log('🔄 Creating new user in database...')
      user = await createUser(userProfile.id, {
        githubId: userProfile.id,
        login: userProfile.login,
        name: userProfile.name,
        email: userProfile.email,
        avatar_url: userProfile.avatar_url,
        bio: userProfile.bio,
        location: userProfile.location,
        company: userProfile.company,
        blog: userProfile.blog,
        twitter_username: userProfile.twitter_username,
        public_repos: userProfile.public_repos,
        followers: userProfile.followers,
        following: userProfile.following,
        created_at: userProfile.created_at,
        updated_at: userProfile.updated_at
      });
    } else {
      console.log('🔄 Updating existing user in database...')
      // Update existing user
      user = await updateUser(userProfile.id, {
        name: userProfile.name,
        email: userProfile.email,
        avatar_url: userProfile.avatar_url,
        bio: userProfile.bio,
        location: userProfile.location,
        company: userProfile.company,
        blog: userProfile.blog,
        twitter_username: userProfile.twitter_username,
        public_repos: userProfile.public_repos,
        followers: userProfile.followers,
        following: userProfile.following,
        updated_at: userProfile.updated_at,
        lastLogin: new Date().toISOString()
      });
    }

    console.log('🔄 Creating session...')
    // Create session
    const sessionId = uuidv4();
    const session = await createSession(sessionId, {
      githubId: userProfile.id,
      login: userProfile.login,
      name: userProfile.name,
      avatar_url: userProfile.avatar_url,
      accessToken: access_token
    });

    console.log('🔄 Generating JWT token...')
    // Generate JWT token
    const token = jwt.sign(
      { 
        sessionId: sessionId,
        githubId: userProfile.id,
        login: userProfile.login
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    console.log('🔄 Redirecting directly to homepage...')
    // Redirect directly to the homepage with token in localStorage via URL params
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? 'https://your-frontend-domain.com'
      : 'http://localhost:3000';

    const redirectUrl = `${frontendUrl}/?auth_token=${token}&auth_user=${encodeURIComponent(JSON.stringify(userProfile))}`;
    console.log('✅ OAuth callback completed, redirecting directly to homepage:', redirectUrl)
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('❌ GitHub OAuth callback error:', error);
    
    // Redirect to frontend with error parameters
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? 'https://your-frontend-domain.com'
      : 'http://localhost:3000';
    
    const errorMessage = error.message || 'Failed to complete GitHub authentication';
    const redirectUrl = `${frontendUrl}/?auth_error=${encodeURIComponent('Authentication failed')}&auth_message=${encodeURIComponent(errorMessage)}`;
    
    console.log('❌ Redirecting to frontend with general error:', redirectUrl);
    res.redirect(redirectUrl);
  }
}));

// Test endpoint to check authentication status
router.get('/status', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      authenticated: false,
      message: 'No Bearer token provided'
    });
  }

  const token = authHeader.substring(7);
  
  try {
    // Check if it's demo token
    if (token === 'demo-token') {
      return res.json({
        authenticated: true,
        user: {
          id: 1,
          login: 'demo-user',
          name: 'Demo User',
          avatar_url: 'https://github.com/github.png'
        },
        mode: 'demo'
      });
    }
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const session = await getSession(decoded.sessionId);
    
    if (!session) {
      return res.status(401).json({
        authenticated: false,
        message: 'Invalid session'
      });
    }

    // Test GitHub API access with the token
    try {
      const { getUserProfile } = require('../utils/github.cjs');
      const userProfile = await getUserProfile(session.accessToken);
      console.log('✅ GitHub API test successful for user:', userProfile.login);
      
      return res.json({
        authenticated: true,
        user: {
          id: session.githubId,
          login: session.login,
          name: session.name,
          avatar_url: session.avatar_url
        },
        mode: 'github',
        githubApiTest: 'success',
        githubUser: userProfile.login
      });
    } catch (githubError) {
      console.error('❌ GitHub API test failed:', githubError.message);
      return res.json({
        authenticated: true,
        user: {
          id: session.githubId,
          login: session.login,
          name: session.name,
          avatar_url: session.avatar_url
        },
        mode: 'github',
        githubApiTest: 'failed',
        githubError: githubError.message
      });
    }
  } catch (error) {
    return res.status(401).json({
      authenticated: false,
      message: 'Invalid token'
    });
  }
}));

// Validate token
router.get('/validate', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Access token required',
      message: 'Please provide a valid Bearer token'
    });
  }

  const token = authHeader.substring(7);
  
  // Handle demo token
  if (token === 'demo-token') {
    return res.json({
      valid: true,
      user: {
        id: 1,
        login: 'demo-user',
        name: 'Demo User',
        email: 'demo@example.com',
        avatar_url: 'https://github.com/github.png',
        bio: 'Demo user for development',
        location: 'Demo City',
        company: 'Demo Corp',
        blog: 'https://demo.com',
        twitter_username: 'demo',
        public_repos: 2,
        followers: 50,
        following: 25,
        created_at: '2023-01-01T00:00:00Z',
        lastLogin: new Date().toISOString()
      }
    });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await getUser(decoded.githubId);
    
    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        message: 'User does not exist'
      });
    }

    res.json({
      valid: true,
      user: {
        id: user.githubId,
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
        email: user.email,
        bio: user.bio,
        location: user.location,
        company: user.company,
        blog: user.blog,
        twitter_username: user.twitter_username,
        public_repos: user.public_repos,
        followers: user.followers,
        following: user.following,
        created_at: user.created_at,
        lastLogin: user.lastLogin
      }
    });
  } catch (error) {
    res.status(401).json({
      valid: false,
      error: 'Invalid token',
      message: 'The provided token is invalid or expired'
    });
  }
}));

// Logout
router.post('/logout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Access token required',
      message: 'Please provide a valid Bearer token'
    });
  }

  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Delete session
    await deleteSession(decoded.sessionId);
    
    res.json({
      message: 'Successfully logged out',
      success: true
    });
  } catch (error) {
    // Even if token is invalid, consider logout successful
    res.json({
      message: 'Successfully logged out',
      success: true
    });
  }
}));

// Refresh token
router.post('/refresh', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Access token required',
      message: 'Please provide a valid Bearer token'
    });
  }

  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    
    // Generate new token
    const newToken = jwt.sign(
      { 
        sessionId: decoded.sessionId,
        githubId: decoded.githubId,
        login: decoded.login
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token: newToken,
      message: 'Token refreshed successfully'
    });
  } catch (error) {
    res.status(401).json({
      error: 'Invalid token',
      message: 'Cannot refresh invalid token'
    });
  }
}));

// Get current user profile
router.get('/profile', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Access token required',
      message: 'Please provide a valid Bearer token'
    });
  }

  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await getUser(decoded.githubId);
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }

    res.json({
      user: {
        id: user.githubId,
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
        email: user.email,
        bio: user.bio,
        location: user.location,
        company: user.company,
        blog: user.blog,
        twitter_username: user.twitter_username,
        public_repos: user.public_repos,
        followers: user.followers,
        following: user.following,
        created_at: user.created_at,
        lastLogin: user.lastLogin,
        analytics: user.analytics
      }
    });
  } catch (error) {
    res.status(401).json({
      error: 'Invalid token',
      message: 'The provided token is invalid or expired'
    });
  }
}));

// Update user profile
router.put('/profile', [
  body('name').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('bio').optional().isString().trim().isLength({ max: 500 }),
  body('location').optional().isString().trim().isLength({ max: 100 }),
  body('company').optional().isString().trim().isLength({ max: 100 }),
  body('blog').optional().isURL().trim(),
  body('twitter_username').optional().isString().trim().isLength({ max: 50 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation Error',
      details: errors.array()
    });
  }

  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Access token required',
      message: 'Please provide a valid Bearer token'
    });
  }

  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await updateUser(decoded.githubId, req.body);
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User profile not found'
      });
    }

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.githubId,
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
        email: user.email,
        bio: user.bio,
        location: user.location,
        company: user.company,
        blog: user.blog,
        twitter_username: user.twitter_username,
        public_repos: user.public_repos,
        followers: user.followers,
        following: user.following,
        created_at: user.created_at,
        lastLogin: user.lastLogin,
        analytics: user.analytics
      }
    });
  } catch (error) {
    res.status(401).json({
      error: 'Invalid token',
      message: 'The provided token is invalid or expired'
    });
  }
}));

// User Notes CRUD
router.get('/notes', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const notes = await getUserNotes(decoded.githubId);
    res.json({ notes });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));
router.post('/notes', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const note = req.body;
    if (!note || !note.id) return res.status(400).json({ error: 'Note id required' });
    await addUserNote(decoded.githubId, note);
    const notes = await getUserNotes(decoded.githubId);
    res.json({ notes });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));
router.put('/notes/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const noteId = req.params.id;
    const updates = req.body;
    await updateUserNote(decoded.githubId, noteId, updates);
    const notes = await getUserNotes(decoded.githubId);
    res.json({ notes });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));
router.delete('/notes/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const noteId = req.params.id;
    await deleteUserNote(decoded.githubId, noteId);
    const notes = await getUserNotes(decoded.githubId);
    res.json({ notes });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));
// Saved Filters CRUD
router.get('/filters', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const filters = await getUserSavedFilters(decoded.githubId);
    res.json({ filters });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));
router.post('/filters', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const filter = req.body;
    if (!filter || !filter.id) return res.status(400).json({ error: 'Filter id required' });
    await addUserSavedFilter(decoded.githubId, filter);
    const filters = await getUserSavedFilters(decoded.githubId);
    res.json({ filters });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));
router.put('/filters/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const filterId = req.params.id;
    const updates = req.body;
    await updateUserSavedFilter(decoded.githubId, filterId, updates);
    const filters = await getUserSavedFilters(decoded.githubId);
    res.json({ filters });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));
router.delete('/filters/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const filterId = req.params.id;
    await deleteUserSavedFilter(decoded.githubId, filterId);
    const filters = await getUserSavedFilters(decoded.githubId);
    res.json({ filters });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));
// Pinned Items CRUD
router.get('/pins', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const pins = await getUserPinnedItems(decoded.githubId);
    res.json({ pins });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));
router.post('/pins', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const pin = req.body;
    if (!pin || !pin.id) return res.status(400).json({ error: 'Pin id required' });
    await addUserPinnedItem(decoded.githubId, pin);
    const pins = await getUserPinnedItems(decoded.githubId);
    res.json({ pins });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));
router.delete('/pins/:id', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const pinId = req.params.id;
    await removeUserPinnedItem(decoded.githubId, pinId);
    const pins = await getUserPinnedItems(decoded.githubId);
    res.json({ pins });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}));

module.exports = router; 