class EmployeesApi {
  constructor(client) {
    this.client = client;
  }

  list(params = {}) {
    return this.client.get('/pim/employees', { params });
  }

  get(empNumber) {
    return this.client.get(`/pim/employees/${empNumber}`);
  }

  create({ firstName, lastName, middleName, employeeId }) {
    return this.client.post('/pim/employees', {
      firstName,
      lastName,
      middleName,
      employeeId,
    });
  }

  delete(empNumbers) {
    const ids = Array.isArray(empNumbers) ? empNumbers : [empNumbers];
    return this.client.delete('/pim/employees', { ids });
  }
}

module.exports = { EmployeesApi };
