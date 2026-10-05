const { encodeSegment } = require('../resource');

class UsersApi {
  constructor(client) {
    this.client = client;
  }

  list(params = {}) {
    return this.client.get('/admin/users', { params });
  }

  get(id, params) {
    return this.client.get(`/admin/users/${encodeSegment(id)}`, { params });
  }

  create(data) {
    return this.client.post('/admin/users', data);
  }

  update(id, data) {
    return this.client.put(`/admin/users/${encodeSegment(id)}`, data);
  }

  delete(ids) {
    const userIds = Array.isArray(ids) ? ids : [ids];
    return this.client.delete('/admin/users', { ids: userIds });
  }
}

module.exports = { UsersApi };
