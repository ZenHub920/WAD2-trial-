import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

import App from './App.vue';
import './assets/base.css';

import HomeView from './views/HomeView.vue';
import ConcertsView from './views/ConcertsView.vue';
import ConcertView from './views/ConcertView.vue';
import AlgorithmView from './views/AlgorithmView.vue';
import RoundView from './views/RoundView.vue';
import MethodView from './views/MethodView.vue';
import LoginView from './views/LoginView.vue';
import MarketplaceView from './views/MarketplaceView.vue';
import ListingView from './views/ListingView.vue';
import MyListingsView from './views/MyListingsView.vue';
import TicketDetailView from './views/TicketDetailView.vue';
import KakiFinderView from './views/KakiFinderView.vue';
import ProfileHistoryView from './views/ProfileHistoryView.vue';
import ComingSoonView from './views/ComingSoonView.vue';
import NotFoundView from './views/NotFoundView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Encore' } },
    { path: '/concerts', name: 'concerts', component: ConcertsView, meta: { title: 'Concerts' } },
    { path: '/concerts/:id', name: 'concert', component: ConcertView, props: true },
    {
      path: '/concerts/:id/algorithm',
      name: 'algorithm',
      component: AlgorithmView,
      props: true,
      meta: { title: 'How the matching runs' },
    },
    { path: '/rounds/:id', name: 'round', component: RoundView, props: true },
    { path: '/method', name: 'method', component: MethodView, meta: { title: 'Method' } },
    { path: '/login', name: 'login', component: LoginView, meta: { title: 'Sign in' } },
    { path: '/marketplace', name: 'marketplace', component: MarketplaceView, meta: { title: 'Ticket Market' } },
    { path: '/list-ticket', name: 'list-ticket', component: ListingView, meta: { title: 'List a Ticket' } },
    { path: '/my-listings', name: 'my-listings', component: MyListingsView, meta: { title: 'My Listings' } },
    { path: '/tickets/:id', name: 'ticket-detail', component: TicketDetailView, props: true, meta: { title: 'Ticket Details' } },

    { path: '/kaki', name: 'kaki', component: KakiFinderView, meta: { title: 'Kaki Finder' } },
    {
      path: '/kaki/history',
      name: 'kaki-history',
      component: ProfileHistoryView,
      meta: { title: 'Profile History' },
    },

    // Tabs owned by other branches. Routed so the shell is complete; the view
    // says who each is waiting on rather than pretending to be the feature.
    {
      path: '/chat',
      name: 'chat',
      component: ComingSoonView,
      props: {
        title: 'Chat',
        body: 'Messaging has not been built yet. Kaki likes and mutual matches are saved to your account, but chat is not available.',
      },
      meta: { title: 'Chat' },
    },
    {
      path: '/profile',
      name: 'profile',
      component: ComingSoonView,
      props: {
        title: 'Profile',
        body: 'Profile creation and editing is still missing: registration only collects a name, email and password, and everything else takes a default.',
      },
      meta: { title: 'Profile' },
    },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
  ],
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, behavior: 'smooth', top: 80 };
    return { top: 0 };
  },
});

router.afterEach((to) => {
  const title = to.meta?.title;
  document.title = title ? `${title} · Encore` : 'Encore';
});

createApp(App).use(router).mount('#app');
