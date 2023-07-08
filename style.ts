import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "space-evenly",
    alignItems: "center",
  },
  widget: {
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    zIndex: 4,
  },
  paragraph: {
    color: "#fff",
    backgroundColor: "transparent",
    alignItems: "center",
    fontSize: 24,
  },
  fullScreen: {
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
  },
});
