import { createComponent } from "./olova.js";

const Button = createComponent({
  template: `
      <h1>{title}</h1>
      <p>{message}</p>
      <button @click="handleClick">Click me</button>
  `,
  data() {
    return {
      title: "Hello",
      message: "Welcome to Olova.js",
    };
  },
  methods: {
    handleClick() {
      this.message = "Button was clicked!";
    },
  },
  mounted() {
    console.log("Component is mounted!");
  },
});

export default Button;
