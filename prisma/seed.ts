import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_TAGS: { name: string; category: string }[] = [
  // Phase
  { name: 'Planning', category: 'Phase' },
  { name: 'Active', category: 'Phase' },
  { name: 'Recruiting', category: 'Phase' },
  { name: 'Shipped', category: 'Phase' },
  // Stack
  { name: 'React', category: 'Stack' },
  { name: 'Next.js', category: 'Stack' },
  { name: 'NestJS', category: 'Stack' },
  { name: 'TypeScript', category: 'Stack' },
  { name: 'Unity', category: 'Stack' },
  { name: 'Unreal', category: 'Stack' },
  { name: 'Three.js', category: 'Stack' },
  { name: 'Flutter', category: 'Stack' },
  { name: 'Swift', category: 'Stack' },
  // Domain
  { name: 'Website', category: 'Domain' },
  { name: 'Mobile', category: 'Domain' },
  { name: 'UX', category: 'Domain' },
  { name: 'Game', category: 'Domain' },
  { name: 'VR', category: 'Domain' },
  { name: 'AR', category: 'Domain' },
  { name: 'XR', category: 'Domain' },
  { name: 'Virtual Production', category: 'Domain' },
];

const DEFAULT_COLLABORATION_ROLES = [
  'Frontend Engineer',
  'Backend Engineer',
  'Mobile Engineer',
  'UI/UX Designer',
  'Game Developer',
  'XR Developer',
  'Project Manager',
  'QA/QC Engineer',
  'DevOps Engineer',
  'Research Assistant',
  'Content Creator',
];

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  for (const tag of DEFAULT_TAGS) {
    const slug = `${slugify(tag.category)}-${slugify(tag.name)}`;
    await prisma.tag.upsert({
      where: { slug },
      update: { name: tag.name, category: tag.category },
      create: { ...tag, slug },
    });
  }

  for (let i = 0; i < DEFAULT_COLLABORATION_ROLES.length; i++) {
    const name = DEFAULT_COLLABORATION_ROLES[i];
    await prisma.collaborationRole.upsert({
      where: { name },
      update: { order: i },
      create: { name, order: i },
    });
  }

  // Feature flags: register known keys (disabled by default — safe). Only
  // create if absent so an operator's toggled value is never reset on reseed.
  const DEFAULT_FLAGS: { key: string; description: string }[] = [
    {
      key: 'ui.maintenance_banner',
      description: 'Show a site-wide maintenance banner in the frontend.',
    },
  ];
  for (const f of DEFAULT_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      update: {}, // never override an operator's live value
      create: { key: f.key, enabled: false, description: f.description },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${DEFAULT_TAGS.length} tags, ${DEFAULT_COLLABORATION_ROLES.length} collaboration roles, ${DEFAULT_FLAGS.length} feature flags.`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
