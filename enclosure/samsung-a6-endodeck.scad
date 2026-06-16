// Full EndoDeck enclosure for Samsung Galaxy A6 2018 SM-A600FN.
// Print the front bezel face-down and the rear cover inner-face-down.

$fn = 64;

part = "assembly"; // front, rear, assembly
preview_phone = true;

// Official body dimensions: 149.9 x 70.8 x 7.7 mm.
phone_width = 149.9;
phone_height = 70.8;
phone_thickness = 7.7;
phone_corner = 5.6;

// 5.6-inch 18.5:9 active area, rotated into landscape.
screen_width = 128.2;
screen_height = 62.4;
screen_offset_x = 0;
screen_offset_y = 0;

clearance = 0.6;
front_skin = 2.5;
shell_depth = 11.4;
outer_width = 164;
outer_height = 86;
outer_corner = 7.4;

cover_width = 162;
cover_height = 84;
cover_thickness = 3.2;
cover_corner = 6.8;

screw_x = 75.4;
screw_y = 36.8;
pilot_diameter = 2.55;
clearance_hole = 3.4;
head_recess = 6.4;

view_angle = 55;
stand_foot_y = -15;
stand_height = 28;

module rounded_rect_2d(width, height, radius) {
    offset(r = radius)
        square([width - radius * 2, height - radius * 2], center = true);
}

module rounded_prism(width, height, depth, radius) {
    linear_extrude(height = depth)
        rounded_rect_2d(width, height, radius);
}

module screw_positions() {
    for (x = [-screw_x, screw_x])
        for (y = [-screw_y, screw_y])
            translate([x, y, 0]) children();
}

module screen_aperture() {
    translate([screen_offset_x, screen_offset_y, -0.2])
        linear_extrude(height = front_skin + 0.5, scale = [1.012, 1.022])
            rounded_rect_2d(screen_width, screen_height, 2.4);
}

module usb_opening(extra_depth = 0) {
    // The phone is rotated clockwise, so the bottom micro-USB exits on the left.
    translate([-outer_width / 2 - 1, -8.5, front_skin + 0.7])
        cube([10.5 + extra_depth, 17, 8.4]);
}

module button_openings() {
    // Slim side reliefs keep power/volume reachable without exposing the phone body.
    translate([-48, outer_height / 2 - 4, front_skin + 1.0])
        cube([46, 8, 7.2]);
    translate([32, -outer_height / 2 - 4, front_skin + 1.0])
        cube([42, 8, 7.2]);
}

module front_bezel() {
    difference() {
        union() {
            rounded_prism(outer_width, outer_height, shell_depth, outer_corner);

            screw_positions()
                translate([0, 0, front_skin])
                    cylinder(h = shell_depth - front_skin, d = 6.2);
        }

        translate([0, 0, front_skin])
            linear_extrude(height = shell_depth + 1)
                rounded_rect_2d(
                    phone_width + clearance * 2,
                    phone_height + clearance * 2,
                    phone_corner + clearance
                );

        screen_aperture();
        usb_opening();
        button_openings();

        screw_positions()
            translate([0, 0, shell_depth - 6.8])
                cylinder(h = 8, d = pilot_diameter);
    }
}

module vent_slots() {
    for (x = [-48, -32, -16, 0, 16, 32, 48])
        translate([x, 3, -0.2])
            rounded_prism(7, 38, cover_thickness + 0.5, 2.5);
}

module kickstand_leg(x) {
    hull() {
        translate([x - 5, -3, cover_thickness - 0.1])
            cube([10, 20, 5]);
        translate([x - 7, stand_foot_y - 8, stand_height])
            cube([14, 18, 5]);
    }

    difference() {
        translate([x - 9, stand_foot_y - 10, stand_height - 1])
            cube([18, 22, 6]);
        translate([x - 6, stand_foot_y - 8, stand_height + 4.2])
            cube([12, 18, 1.1]);
    }
}

module rear_cover() {
    difference() {
        union() {
            rounded_prism(cover_width, cover_height, cover_thickness, cover_corner);
            kickstand_leg(-65);
            kickstand_leg(65);
        }

        vent_slots();

        translate([-cover_width / 2 - 1, -9, -0.2])
            cube([9.5, 18, cover_thickness + 0.5]);

        screw_positions() {
            translate([0, 0, -0.2]) cylinder(h = cover_thickness + 5, d = clearance_hole);
            translate([0, 0, 1.5]) cylinder(h = cover_thickness + 5, d = head_recess);
        }
    }

    translate([0, 31, cover_thickness])
        linear_extrude(height = 0.7)
            text("ENDO DECK", size = 5, halign = "center", valign = "center", font = "Bahnschrift:style=Bold");
}

module phone_mockup() {
    color([0.025, 0.028, 0.025])
        translate([0, 0, front_skin])
            rounded_prism(phone_width, phone_height, phone_thickness, phone_corner);

    color([0.10, 0.16, 0.08])
        translate([screen_offset_x, screen_offset_y, front_skin - 0.08])
            linear_extrude(height = 0.12)
                rounded_rect_2d(screen_width - 0.8, screen_height - 0.8, 2.0);
}

module assembly() {
    color([0.10, 0.115, 0.10]) front_bezel();
    if (preview_phone) phone_mockup();
    color([0.07, 0.08, 0.07])
        translate([0, 0, shell_depth]) rear_cover();
}

if (part == "front") {
    front_bezel();
} else if (part == "rear") {
    rear_cover();
} else {
    translate([0, 0, 35])
        rotate([180 - view_angle, 0, 0])
            assembly();
}
