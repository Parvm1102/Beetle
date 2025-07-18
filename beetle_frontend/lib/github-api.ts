const API_BASE_URL = 'http://localhost:3001/api';

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string;
  language: string;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  private: boolean;
  html_url: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

export interface Commit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
  author: {
    login: string;
    avatar_url: string;
  };
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: {
    login: string;
    avatar_url: string;
  };
  head: {
    ref: string;
  };
  base: {
    ref: string;
  };
}

export interface Issue {
  id: number;
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: {
    login: string;
    avatar_url: string;
  };
  labels: Array<{
    name: string;
    color: string;
  }>;
}

export interface UserActivity {
  id: string;
  type: string;
  actor: {
    login: string;
    avatar_url: string;
  };
  repo: {
    name: string;
  };
  created_at: string;
  payload: any;
}

class GitHubAPI {
  private token: string;
  private lastUpdateTimestamp: string;

  constructor(token: string) {
    this.token = token;
    this.lastUpdateTimestamp = new Date().toISOString();
  }

  // Check if the backend is accessible
  async checkBackendHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL.replace('/api', '')}/health`);
      return response.ok;
    } catch (error) {
      console.error('Backend health check failed:', error);
      return false;
    }
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    console.log(`Making request to: ${API_BASE_URL}${endpoint}`);
    console.log('Token:', this.token ? 'Available' : 'Not available');
    
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error Response:', errorText);
        throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log('API Response data:', data);
      return data;
    } catch (error) {
      console.error('Request failed:', error);
      
      // Provide more specific error information
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to the server. Please check your connection and try again.');
      } else if (error instanceof Error) {
        throw error;
      } else {
        throw new Error(`Request failed: ${String(error)}`);
      }
    }
  }

  // Get user repositories
  async getUserRepositories(page = 1, per_page = 100): Promise<Repository[]> {
    const response = await this.request(`/github/repositories?page=${page}&per_page=${per_page}`);
    return response.repositories;
  }

  // Get repository details
  async getRepository(owner: string, repo: string) {
    const response = await this.request(`/github/repositories/${owner}/${repo}`);
    return response.repository;
  }

  // Get repository commits
  async getRepositoryCommits(owner: string, repo: string, branch = 'main', page = 1, per_page = 100): Promise<Commit[]> {
    const response = await this.request(`/github/repositories/${owner}/${repo}/commits?branch=${branch}&page=${page}&per_page=${per_page}`);
    return response.commits;
  }

  // Get aggregated pull requests from all user repositories
  async getAggregatedPullRequests(state = 'all', limit = 10): Promise<PullRequest[]> {
    const response = await this.request(`/aggregated/pull-requests?state=${state}&limit=${limit}`);
    return response.pullRequests;
  }

  // Get aggregated issues from all user repositories
  async getAggregatedIssues(state = 'all', limit = 10): Promise<Issue[]> {
    const response = await this.request(`/aggregated/issues?state=${state}&limit=${limit}`);
    return response.issues;
  }

  // Get aggregated summary of all user repositories
  async getAggregatedSummary(limit = 10) {
    const response = await this.request(`/aggregated/summary?limit=${limit}`);
    return response;
  }

  // Get repository pull requests
  async getRepositoryPullRequests(owner: string, repo: string, state = 'open', page = 1, per_page = 100): Promise<PullRequest[]> {
    const response = await this.request(`/github/repositories/${owner}/${repo}/pulls?state=${state}&page=${page}&per_page=${per_page}`);
    return response.pullRequests;
  }

  // Get repository issues
  async getRepositoryIssues(owner: string, repo: string, state = 'open', page = 1, per_page = 100): Promise<Issue[]> {
    const response = await this.request(`/github/repositories/${owner}/${repo}/issues?state=${state}&page=${page}&per_page=${per_page}`);
    return response.issues;
  }

  // Get user activity
  async getUserActivity(username?: string, page = 1, per_page = 100): Promise<UserActivity[]> {
    const params = new URLSearchParams({
      page: page.toString(),
      per_page: per_page.toString(),
    });
    if (username) {
      params.append('username', username);
    }
    const response = await this.request(`/github/activity?${params}`);
    return response.activity;
  }

  // Search repositories
  async searchRepositories(query: string, page = 1, per_page = 100) {
    const response = await this.request(`/github/search/repositories?q=${encodeURIComponent(query)}&page=${page}&per_page=${per_page}`);
    return response.repositories;
  }

  // Get repository branches
  async getRepositoryBranches(owner: string, repo: string) {
    const response = await this.request(`/github/repositories/${owner}/${repo}/branches`);
    return response.branches;
  }

  // Get repository contributors
  async getRepositoryContributors(owner: string, repo: string) {
    const response = await this.request(`/github/repositories/${owner}/${repo}/contributors`);
    return response.contributors;
  }

  // Get repository languages
  async getRepositoryLanguages(owner: string, repo: string) {
    const response = await this.request(`/github/repositories/${owner}/${repo}/languages`);
    return response.languages;
  }

  // Get current user profile
  async getCurrentUserProfile() {
    const response = await this.request('/auth/profile');
    return response.user;
  }

  // Update current user profile
  async updateCurrentUserProfile(updateData: any) {
    const response = await this.request('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
    return response.user;
  }

  // Get repository tree structure
  async getRepositoryTree(owner: string, repo: string, branch: string = 'main') {
    const response = await this.request(`/github/repositories/${owner}/${repo}/tree?branch=${branch}`);
    return response.tree;
  }

  // Get file trees from all branches
  async getRepositoryTreesForAllBranches(owner: string, repo: string) {
    const response = await this.request(`/github/repositories/${owner}/${repo}/trees`);
    return response.treesByBranch;
  }

  // Get all branches with their file trees (comprehensive data)
  async getBranchesWithTrees(owner: string, repo: string) {
    const response = await this.request(`/github/repositories/${owner}/${repo}/branches-with-trees`);
    return response;
  }

  // Get file content
  async getFileContent(owner: string, repo: string, path: string, branch: string = 'main') {
    const response = await this.request(`/github/repositories/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`);
    return response.content;
  }

  // Get user starred repositories
  async getUserStarredRepositories(page = 1, per_page = 100): Promise<Repository[]> {
    const response = await this.request(`/github/starred?page=${page}&per_page=${per_page}`);
    return response.repositories;
  }

  // Get trending repositories
  async getTrendingRepositories(since = 'daily', language?: string): Promise<Repository[]> {
    const params = new URLSearchParams({
      since: since,
    });
    if (language) {
      params.append('language', language);
    }
    const response = await this.request(`/github/trending?${params}`);
    return response.repositories;
  }

  // Get recent changes since last update
  async getRecentChanges(): Promise<{
    commits: Commit[];
    prs: PullRequest[];
    issues: Issue[];
    stats: {
      newStars: number;
      newForks: number;
    };
  }> {
    try {
      const response = await this.request(`/github/recent-changes?since=${this.lastUpdateTimestamp}`);
      this.lastUpdateTimestamp = new Date().toISOString();
      return response;
    } catch (error) {
      console.error('Failed to fetch recent changes:', error);
      throw error;
    }
  }

  // Update last fetch timestamp
  updateLastFetchTime() {
    this.lastUpdateTimestamp = new Date().toISOString();
  }
}

export default GitHubAPI; 