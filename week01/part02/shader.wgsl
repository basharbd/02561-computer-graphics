@vertex
fn main_vs(@location(0) pos: vec2f) -> @builtin(position) vec4f {
  // Convert 2D clip-space position to a 4D clip-space position
  return vec4f(pos, 0.0, 1.0);
}

@fragment
fn main_fs() -> @location(0) vec4f {
  // Output solid black with full opacity
  return vec4f(0.0, 0.0, 0.0, 1.0);
}
