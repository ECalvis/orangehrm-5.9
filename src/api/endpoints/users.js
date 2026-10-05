class UsersApi {
  constructor(client) {
    this.client = client;
  }

  list(params = {}) {
    return this.client.get('/admin/users', { params });
  }

  create({ username, password, status, userRoleId, empNumber }) {
    return this.client.post('/admin/users', {
      username,
      password,
      status,
      userRoleId,
      empNumber,
    });
  }

  delete(ids) {
    const userIds = Array.isArray(ids) ? ids : [ids];
    return this.client.delete('/admin/users', { ids: userIds });
  }
}

module.exports = { UsersApi };
