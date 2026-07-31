<!--
  ShellApp.vue — the SST shell's root island. Renders the kinds gallery
  and the upload-package affordance. Each kind card links to
  /kind/<kind-id> (which lists that kind's instances).
-->
<template>
  <div class="shell-root">
    <header class="shell-header">
      <div class="brand">
        <span class="mark" aria-hidden="true" />
        <span class="name">Primmel SST</span>
        <span class="sub">Simulated SMART Twin</span>
      </div>
      <div class="actions">
        <a class="btn" href="/upload">Upload package…</a>
        <a class="btn primary" href="https://www.primmel.org/primmel-oiml-smart/" target="_blank" rel="noreferrer">Docs ↗</a>
      </div>
    </header>

    <main class="shell-main">
      <h1 class="title">Choose an instrument kind</h1>
      <p class="intro">
        Each kind maps to an OIML Recommendation. Pick one to see the available instrument instances,
        or upload a new kind package.
      </p>

      <div class="kind-grid">
        <a v-for="kind in props.kinds" :key="kind.id" class="kind-card" :href="`/kind/${kind.id}`">
          <div class="card-head">
            <span class="card-title">{{ kind.title }}</span>
            <span class="card-rec">{{ kind.oimlRecommendation }}</span>
          </div>
          <div class="card-meta">
            <span class="meta-item">active domain: <code>{{ kind.activeDomain }}</code></span>
            <span class="meta-item">{{ kind.instances.length }} instance{{ kind.instances.length === 1 ? '' : 's' }}</span>
          </div>
          <ul class="instance-preview">
            <li v-for="inst in kind.instances.slice(0, 3)" :key="inst.id">
              <span class="inst-mfr">{{ inst.manufacturer.shortName ?? inst.manufacturer.name }}</span>
              <span class="inst-title">{{ inst.title }}</span>
            </li>
            <li v-if="kind.instances.length === 0" class="empty">(no instances registered)</li>
          </ul>
        </a>
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
  instances: Array<{ id: string; title: string; manufacturer: { id: string; name: string; country: string } }>
}
const props = defineProps<{ kinds: KindEntry[] }>()
</script>

<style scoped>
.shell-root { min-height: 100vh; }
.shell-header {
  display: flex; align-items: center; gap: 1.5rem;
  padding: 0.875rem 1.5rem;
  background: linear-gradient(180deg, #1F232B 0%, #181C23 100%);
  border-bottom: 1px solid var(--color-line);
}
.brand { display: flex; align-items: baseline; gap: 0.625rem; }
.brand .mark {
  width: 10px; height: 10px; border-radius: 2px;
  background: var(--color-twin);
  box-shadow: 0 0 12px rgba(232,163,61,0.25);
  align-self: center;
}
.brand .name { font-family: var(--font-display); font-weight: 600; font-size: 1.1rem; color: var(--color-fg); }
.brand .sub { font-family: var(--font-mono); font-size: 0.72rem; color: var(--color-fg-mute); text-transform: uppercase; letter-spacing: 0.16em; }
.actions { margin-left: auto; display: flex; gap: 0.5rem; }
.btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.4rem 0.875rem; border-radius: 6px;
  border: 1px solid var(--color-line-strong);
  background: var(--color-surface-2);
  color: var(--color-fg);
  font-family: var(--font-body); font-size: 0.82rem; font-weight: 500;
  text-decoration: none;
}
.btn:hover { background: var(--color-surface-3); border-color: var(--color-fg-mute); }
.btn.primary { background: var(--color-twin-soft); border-color: var(--color-twin-line); color: var(--color-twin-bright); }

.shell-main { max-width: 56rem; margin: 0 auto; padding: 3rem 1.5rem; }
.title { font-family: var(--font-display); font-size: 1.75rem; font-weight: 600; margin: 0 0 0.5rem; }
.intro { color: var(--color-fg-dim); margin: 0 0 2.5rem; max-width: 42rem; }

.kind-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 1rem;
}
.kind-card {
  display: block;
  background: var(--color-surface-1);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  padding: 1.25rem;
  text-decoration: none;
  color: var(--color-fg);
  transition: border-color 120ms, transform 120ms;
}
.kind-card:hover { border-color: var(--color-twin); transform: translateY(-2px); }
.card-head { display: flex; align-items: baseline; gap: 0.625rem; margin-bottom: 0.5rem; }
.card-title { font-family: var(--font-display); font-weight: 600; font-size: 1rem; }
.card-rec {
  font-family: var(--font-mono); font-size: 0.7rem;
  color: var(--color-twin); background: var(--color-twin-soft);
  padding: 1px 8px; border-radius: 3px; letter-spacing: 0.04em;
}
.card-meta { display: flex; gap: 1rem; font-size: 0.78rem; color: var(--color-fg-dim); margin-bottom: 0.875rem; }
.card-meta code { font-family: var(--font-mono); color: var(--color-fg); }
.instance-preview {
  list-style: none; padding: 0; margin: 0;
  border-top: 1px solid var(--color-line);
  padding-top: 0.625rem;
}
.instance-preview li { font-size: 0.82rem; padding: 0.2rem 0; color: var(--color-fg-dim); }
.instance-preview .inst-mfr { color: var(--color-world); font-weight: 500; margin-right: 0.4rem; }
.instance-preview .inst-title { color: var(--color-fg); }
.instance-preview .empty { color: var(--color-fg-mute); font-style: italic; }
</style>
