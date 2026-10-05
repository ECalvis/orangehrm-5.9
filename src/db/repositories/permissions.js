class PermissionsRepository {
  constructor(client) {
    this.client = client;
  }

  async dataGroupIdForApi(apiClass) {
    return this.client.selectValue('SELECT data_group_id FROM ohrm_api_permission WHERE api_name = ?', [
      apiClass,
    ]);
  }

  async rolePermissionsForApi(apiClass) {
    return this.client.select(
      `SELECT ur.id   AS user_role_id,
              ur.name AS user_role_name,
              urdg.can_read, urdg.can_create, urdg.can_update, urdg.can_delete,
              urdg.self
         FROM ohrm_api_permission ap
         JOIN ohrm_user_role_data_group urdg ON urdg.data_group_id = ap.data_group_id
         JOIN ohrm_user_role ur               ON ur.id = urdg.user_role_id
        WHERE ap.api_name = ?
        ORDER BY ur.id`,
      [apiClass],
    );
  }

  async isActionAllowed(workflow, state, role, action) {
    const count = await this.client.selectValue(
      `SELECT COUNT(*) FROM ohrm_workflow_state_machine
        WHERE workflow = ? AND state = ? AND role = ? AND action = ?`,
      [String(workflow), state, role, String(action)],
    );
    return Number(count) > 0;
  }
}

module.exports = { PermissionsRepository };
