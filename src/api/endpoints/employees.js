const { encodeSegment } = require('../resource');

class EmployeesApi {
  constructor(client) {
    this.client = client;
  }

  list(params = {}) {
    return this.client.get('/pim/employees', { params });
  }

  get(empNumber) {
    return this.client.get(`/pim/employees/${encodeSegment(empNumber)}`);
  }

  create(data) {
    return this.client.post('/pim/employees', data);
  }

  update(empNumber, data) {
    return this.client.put(`/pim/employees/${encodeSegment(empNumber)}`, data);
  }

  delete(empNumbers) {
    const ids = Array.isArray(empNumbers) ? empNumbers : [empNumbers];
    return this.client.delete('/pim/employees', { ids });
  }
}

module.exports = { EmployeesApi };
