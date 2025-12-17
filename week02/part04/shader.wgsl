struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f,
};

@vertex
fn main_vs(
  @location(0) inPos : vec2f,
  @location(1) inColor : vec4f
) -> VSOut {
  var out : VSOut;
  out.position = vec4f(inPos, 0.0, 1.0);
  out.color = inColor;
  return out;
}

@fragment
fn main_fs(@location(0) c : vec4f) -> @location(0) vec4f {
  return c;
}
