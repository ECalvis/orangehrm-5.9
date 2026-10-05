const { collectionMeta, deletedIds, emptyMeta } = require('../schemas/common');
const {
  userBody: userCreateBody,
  userDeleteBody,
  userListQuery,
  userModel,
} = require('../schemas/users');
const userUpdateBody = { ...userCreateBody };

const userRoutes = {
  list: {
    method: 'GET',
    path: '/admin/users',
    querySchema: userListQuery,
    responseSchema: { type: 'array', items: userModel },
    metaSchema: collectionMeta,
  },
  get: {
    method: 'GET',
    path: '/admin/users/{id}',
    responseSchema: userModel,
    metaSchema: emptyMeta,
  },
  create: {
    method: 'POST',
    path: '/admin/users',
    bodySchema: userCreateBody,
    responseSchema: userModel,
    metaSchema: emptyMeta,
  },
  update: {
    method: 'PUT',
    path: '/admin/users/{id}',
    bodySchema: userUpdateBody,
    responseSchema: userModel,
    metaSchema: emptyMeta,
  },
  delete: {
    method: 'DELETE',
    path: '/admin/users',
    bodySchema: userDeleteBody,
    responseSchema: deletedIds,
    metaSchema: emptyMeta,
  },
};

module.exports = { userRoutes };
