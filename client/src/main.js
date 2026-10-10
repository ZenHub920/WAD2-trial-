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
import MarketView from './views/MarketView.vue';
import ListingView from './views/ListingView.vue';
import OrderReviewView from './views/OrderReviewView.vue';
import CheckoutView from './views/CheckoutView.vue';
import OrderConfirmationView from './views/OrderConfirmationView.vue';
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
    { path: '/market', name: 'market', component: MarketView, meta: { title: 'Ticket market' } },
    {
      path: '/market/:id',
      name: 'listing',
      component: ListingView,
      props: true,
      meta: { title: 'Listing details' },
    },
    {
      path: '/market/:id/order',
      name: 'order-review',
      component: OrderReviewView,
      props: true,
      meta: { title: 'Order details' },
    },
    {
      path: '/market/:id/checkout',
      name: 'checkout',
      component: CheckoutView,
      props: true,
      meta: { title: 'Checkout' },
    },
    {
      path: '/orders/:id',
      name: 'order',
      component: OrderConfirmationView,
      props: true,
      meta: { title: 'Order confirmed' },
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
