import { createApp } from "./olova.js";
import Button from "./button.js";

createApp({
  components: {
    "my-component": Button,
  },
  template: `
  <h1>{message}</h1>
  <button @click="reverseMessage">Reverse Message</button>

  <h1>{count}</h1>
  <button @click="incrementCount">Increment Count</button>

  <my-component />
  
  `,
  data() {
    return {
      message: "Hello world!",
      count: 0,
      showComponent: false,
    };
  },
  methods: {
    reverseMessage() {
      this.message = this.message.split("").reverse().join("");
    },
    incrementCount() {
      this.count++;
    },
  },
  watch: {
    message(newVal) {
      console.log("message changed", newVal);
    },
    count(newVal) {
      console.log("count changed", newVal);
    },
  },
  mounted() {
    console.log("component mounted");
  },
}).mount("#app");
