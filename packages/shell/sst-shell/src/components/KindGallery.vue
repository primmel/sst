<!--
  KindGallery.vue — the instances-of-a-kind view. Lists each instance
  with its samples; clicking a sample starts a session.
-->
<template>
  <div class="shell-root">
    <header class="shell-header">
      <div class="brand">
        <a class="back" href="/">← All kinds</a>
      </div>
      <div class="brand-center">
        <span class="name">{{ props.kind.title }}</span>
        <span class="rec">{{ props.kind.oimlRecommendation }}</span>
      </div>
    </header>

    <main class="shell-main">
      <p class="intro">Active domain: <code>{{ props.kind.activeDomain }}</code>. Choose an instance:</p>

      <div v-if="props.kind.instances.length === 0" class="empty">
        No instances registered for this kind yet. <a href="/upload">Upload one…</a>
      </div>

      <div class="instance-grid">
        <div v-for="inst in props.kind.instances" :key="inst.id" class="instance-card">
          <div class="card-head">
            <span class="mfr">{{ inst.manufacturer.name }}</span>
            <span class="country">{{ inst.manufacturer.country }}</span>
          </div>
          <div class="card-title">{{ inst.title }}</div>
          <ul class="sample-list">
            <li v-for="s in inst.samples" :key="s.name">
              <a class="sample-link" :href="`/session/${inst.id}?sample=${s.name}`">
                {{ s.name }}
              </a>
            </li>
          </ul>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
interface KindEntry {
  id: string
  title: string
  activeDomain: string
  oimlRecommendation: string
  instances: Array<{
    id: string
    title: string
    manufacturer: { id: string; name: string; shortName?: string; country: string }
    samples: Array<{ name: string; path: string }>
  }>
}
const props = defineProps<{ kind: KindEntry }>()
</script>

<style scoped>
.shell-root { min-height: 100vh; }
.shell-header {
  display: flex; align-items: center; gap: 1.5rem;
  padding: 0.875rem 1.5rem;
  background: linear-gradient(180deg, #1F232B 0%, #181C23 100%);
  border-bottom: 1px solid var(--color-line);
}
.back { color: var(--color-fg-dim); text-decoration: none; font-size: 0.85rem; }
.back:hover { color: var(--color-twin); }
.brand-center { display: flex; align-items: baseline; gap: 0.625rem; }
.name { font-family: var(--font-display); font-weight: 600; font-size: 1.1rem; color: var(--color-fg); }
.rec {
  font-family: var(--font-mono); font-size: 0.72rem;
  color: var(--color-twin); background: var(--color-twin-soft);
  padding: 1px 8px; border-radius: 3px; letter-spacing: 0.04em;
}
.shell-main { max-width: 56rem; margin: 0 auto; padding: 2.5rem 1.5rem; }
.intro { color: var(--color-fg-dim); margin: 0 0 2rem; }
.intro code { font-family: var(--font-mono); color: var(--color-world); }
.empty { color: var(--color-fg-mute); font-style: italic; }

.instance-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 1rem;
}
.instance-card {
  background: var(--color-surface-1);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  padding: 1.25rem;
}
.card-head { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.3rem; }
.mfr { color: var(--color-world-bright); font-weight: 500; }
.country { color: var(--color-fg-mute); font-family: var(--font-mono); font-size: 0.7rem; margin-left: auto; }
.card-title { font-family: var(--font-display); font-weight: 600; font-size: 1rem; margin-bottom: 0.875rem; }
.sample-list { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--color-line); padding-top: 0.5rem; }
.sample-list li { padding: 0.25rem 0; }
.sample-link {
  color: var(--color-fg); text-decoration: none; font-size: 0.82rem;
  font-family: var(--font-mono); padding: 2px 8px; border-radius: 4px;
  border: 1px solid transparent;
}
.sample-link:hover {
  background: var(--color-twin-soft); border-color: var(--color-twin-line); color: var(--color-twin-bright);
}
</style>
