<script setup>
import { onMounted,ref } from 'vue';
import { api } from '../api.js';
const props=defineProps({initial:{type:Object,default:()=>({})},busy:Boolean});
const emit=defineEmits(['save']);
const concepts=ref([]),error=ref('');
const selected=ref(Object.fromEntries(['about','wants','avoid'].map(k=>[k,(props.initial[k]??[]).filter(x=>x.recognized!==false).map(x=>x.key??x.conceptId).filter(Boolean)])));
const custom=ref(Object.fromEntries(['about','wants','avoid'].map(k=>[k,(props.initial[k]??[]).filter(x=>x.recognized===false||x.key?.startsWith('custom:')).map(x=>x.text).join('\n')])));
const labels={about:'What I enjoy',wants:'What I enjoy in companions',avoid:'What I prefer to avoid (soft preferences)'};
onMounted(async()=>{try{concepts.value=(await api.preferenceConcepts()).concepts;}catch(e){error.value=e.message;}});
function save(){
 const answers={};for(const k of ['about','wants','avoid'])answers[k]=[
   ...selected.value[k].map(id=>({text:concepts.value.find(c=>c.id===id).label,conceptId:id})),
   ...custom.value[k].split('\n').map(s=>s.trim()).filter(Boolean)];
 emit('save',answers);
}
</script>
<template><form class="group-panel" @submit.prevent="save"><p>Everyone answers individually. Your group's summary reflects each member equally. Custom wording stays visible; recognized concepts improve recommendations.</p><p v-if="error" role="alert">{{ error }}</p><details v-for="(label,intent) in labels" :key="intent" :open="intent==='about'"><summary>{{ label }}</summary><div class="group-controls"><label v-for="c in concepts" :key="c.id" class="group-check"><input v-model="selected[intent]" type="checkbox" :value="c.id" :disabled="busy">{{ c.label }}</label></div><label>Custom preferences — one per line<textarea v-model="custom[intent]" maxlength="3000" rows="3" :disabled="busy" /></label></details><button class="btn btn--primary" :disabled="busy||!concepts.length">Save preferences</button></form></template>
