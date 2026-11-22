// Wrapped (safe) from @docusaurus/theme-classic: if every post is unlisted, /blog says so instead
// of showing an empty "Recent posts" list.
import type { Props } from '@theme/BlogListPage';
import BlogLayout from '@theme/BlogLayout';
import Heading from '@theme/Heading';
import BlogListPage from '@theme-original/BlogListPage';
import type { ReactNode } from 'react';

export default function BlogListPageWrapper(props: Props): ReactNode {
  if (props.items.length > 0) return <BlogListPage {...props} />;
  const { blogTitle, blogDescription } = props.metadata;
  return (
    <BlogLayout title={blogTitle} description={blogDescription}>
      <Heading as="h1">Blog</Heading>
      <p>No posts yet.</p>
    </BlogLayout>
  );
}
