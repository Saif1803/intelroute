import { notFound } from "next/navigation";
import { posts } from "../posts";

export function generateStaticParams() {
  return Object.keys(posts).map((slug) => ({ slug }));
}

export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = posts[slug];
  if (!post) notFound();
  return (
    <main>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
    </main>
  );
}
