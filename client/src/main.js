import { createApp, watch } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

import { currentUser, sessionReady } from './auth.js';

import App from './App.vue';
import './assets/base.css';

import HomeView from './views/HomeView.vue';
import ConcertView from './views/ConcertView.vue';
import AlgorithmView from './views/AlgorithmView.vue';
import RoundView from './views/RoundView.vue';
import MethodView from './views/MethodView.vue';
import LoginView from './views/LoginView.vue';
import ConcertsView from './views/ConcertsView.vue';
import ListingView from './views/ListingView.vue';
import MyListingsView from './views/MyListingsView.vue';
import TicketDetailView from './views/TicketDetailView.vue';
import CheckoutView from './views/CheckoutView.vue';
import OrderConfirmationView from './views/OrderConfirmationView.vue';
import ChatThreadView from './views/ChatThreadView.vue';
import AdminVerificationsView from './views/AdminVerificationsView.vue';
import KakiFinderView from './views/KakiFinderView.vue';
import KakiChatListView from './views/KakiChatListView.vue';
import KakiChatView from './views/KakiChatView.vue';
import ProfileHistoryView from './views/ProfileHistoryView.vue';
import ProfileView from './views/ProfileView.vue';
import NotFoundView from './views/NotFoundView.vue';
import GroupExplorerView from './views/GroupExplorerView.vue';
import GroupConnectionsView from './views/GroupConnectionsView.vue';
import GroupMembershipView from './views/GroupMembershipView.vue';
import MeetupView from './views/MeetupView.vue';
import FeedbackView from './views/FeedbackView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Encore' } },
    { path: '/concerts', name: 'concerts', component: ConcertsView, meta: { title: 'Concerts' } },
    { path: '/concerts/:id', name: 'concert', component: ConcertView, props: true, meta: { title: 'Concert details' } },
    {
      path: '/concerts/:id/algorithm',
      name: 'algorithm',
      component: AlgorithmView,
      props: true,
      meta: { title: 'Matching preview' },
    },
    { path: '/rounds/:id', name: 'round', component: RoundView, props: true, meta: { title: 'Group matching results' } },
    { path: '/method', name: 'method', component: MethodView, meta: { title: 'How it works' } },
    { path: '/login', name: 'login', component: LoginView, meta: { title: 'Sign in' } },
    { path: '/list-ticket', name: 'list-ticket', component: ListingView, meta: { title: 'List a ticket' } },
    { path: '/my-listings', name: 'my-listings', component: MyListingsView, meta: { title: 'My listings' } },
    { path: '/tickets/:id', name: 'ticket-detail', component: TicketDetailView, props: true, meta: { title: 'Ticket details' } },
    // Checkout stays unavailable until a real payment provider is configured.
    { path: '/tickets/:id/checkout', name: 'checkout', component: CheckoutView, props: true, meta: { title: 'Checkout' } },
    { path: '/orders/:id', name: 'order', component: OrderConfirmationView, props: true, meta: { title: 'Historical order' } },
    {
      path: '/operator/verifications',
      name: 'operator-verifications',
      component: AdminVerificationsView,
      meta: { title: 'Ticket verification' },
    },

    { path: '/kaki', name: 'kaki', component: KakiFinderView, meta: { title: 'Find a companion' } },
    { path: '/groups', name: 'groups', component: GroupExplorerView, meta: { title: 'Groups', requiresAuth: true } },
    { path: '/groups/connect', name: 'group-connections', component: GroupConnectionsView, meta: { title: 'My groups', requiresAuth: true } },
    { path:'/groups/invite/:token',component:GroupMembershipView,props:true,meta:{title:'Join your friends',requiresAuth:true} },
    { path:'/groups/:id/members',component:GroupMembershipView,props:true,meta:{title:'Group members',requiresAuth:true} },
    { path:'/meetups',component:MeetupView,meta:{title:'Meetup planning',requiresAuth:true} },
    { path:'/meetups/:id',component:MeetupView,props:true,meta:{title:'Meetup planning',requiresAuth:true} },
    { path:'/feedback',component:FeedbackView,meta:{title:'Post-concert feedback',requiresAuth:true} },
    {
      path: '/kaki/history',
      name: 'kaki-history',
      component: ProfileHistoryView,
      meta: { title: 'Companion history' },
    },

    // One inbox; companion and ticket conversations retain their own threads.
    {
      path: '/messages',
      name: 'kaki-chat',
      component: KakiChatListView,
      meta: { title: 'Messages', requiresAuth: true },
    },
    {
      path: '/kaki/chat/:id',
      name: 'kaki-chat-thread',
      component: KakiChatView,
      props: true,
      meta: { title: 'Companion conversation', requiresAuth: true },
    },

    { path: '/chat/:id', name: 'chat-thread', component: ChatThreadView, props: true, meta: { title: 'Ticket conversation' } },
    { path: '/profile', name: 'profile', component: ProfileView, meta: { title: 'Profile' } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView, meta: { title: 'Page not found' } },
  ],
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, behavior: 'smooth', top: 80 };
    return { top: 0 };
  },
});

// Restore the session before deciding whether a protected page can open.
router.beforeEach(async (to) => {
  if (!to.meta?.requiresAuth) return true;
  if (!sessionReady.value) {
    await new Promise((resolve) => {
      const stop = watch(sessionReady, (ready) => {
        if (!ready) return;
        stop();
        resolve();
      }, { immediate: true });
    });
  }
  if (currentUser.value) return true;
  return { path: '/login', query: { redirect: to.fullPath } };
});

router.afterEach((to) => {
  const title = to.name === 'group-connections'
    ? ({ create: 'Create a group', connections: 'Connect groups' }[to.query.view] ?? 'My groups')
    : to.meta?.title;
  document.title = title && title !== 'Encore' ? `${title} | Encore` : 'Encore';
});

createApp(App).use(router).mount('#app');
