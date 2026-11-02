import Link from "next/link";
import { posts } from "./posts";

export const metadata = { title: "Blog", description: "Articles about routing and the web." };

export default function Blog() {
  return (
    <main>
      <h1>Blog</h1>
      <ul>
        {Object.entries(posts).map(([slug, post]) => (
          <li key={slug}>
            <Link href={`/blog/${slug}`}>{post.title}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
