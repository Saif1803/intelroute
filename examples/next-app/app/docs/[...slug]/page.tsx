export const metadata = { title: "Documentation", description: "Guides and API reference." };

export default async function Docs({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return (
    <main>
      <h1>Docs: {slug.join(" / ")}</h1>
      <p>Documentation content would go here.</p>
    </main>
  );
}
