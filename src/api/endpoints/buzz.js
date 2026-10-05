const { createRouteGroup } = require('../resource');

const route = (method, path) => ({ method, path });

function createBuzzApi(client) {
  return createRouteGroup(client, {
    feed: { list: route('GET', '/buzz/feed') },
    anniversaries: { list: route('GET', '/buzz/anniversaries') },
    posts: {
      create: route('POST', '/buzz/posts'),
      get: route('GET', '/buzz/posts/{id}'),
      update: route('PUT', '/buzz/posts/{id}'),
    },
    shares: {
      create: route('POST', '/buzz/shares'),
      update: route('PUT', '/buzz/shares/{id}'),
      delete: route('DELETE', '/buzz/shares/{id}'),
    },
    shareComments: {
      list: route('GET', '/buzz/shares/{shareId}/comments'),
      create: route('POST', '/buzz/shares/{shareId}/comments'),
      get: route('GET', '/buzz/shares/{shareId}/comments/{commentId}'),
      update: route('PUT', '/buzz/shares/{shareId}/comments/{commentId}'),
      delete: route('DELETE', '/buzz/shares/{shareId}/comments/{commentId}'),
    },
    shareLikes: {
      list: route('GET', '/buzz/shares/{shareId}/likes'),
      create: route('POST', '/buzz/shares/{shareId}/likes'),
      delete: route('DELETE', '/buzz/shares/{shareId}/likes'),
    },
    postShares: {
      list: route('GET', '/buzz/posts/{postId}/shares'),
    },
    validateVideoUrl: { get: route('GET', '/buzz/validation/links') },
    commentLikes: {
      list: route('GET', '/buzz/comments/{commentId}/likes'),
      create: route('POST', '/buzz/comments/{commentId}/likes'),
      delete: route('DELETE', '/buzz/comments/{commentId}/likes'),
    },
  });
}

module.exports = { createBuzzApi };
