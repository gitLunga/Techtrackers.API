using Microsoft.EntityFrameworkCore;
using TechTrackers.Data.Model;

namespace TechTrackers.Data
{
    public class TechTrackersDbContext: DbContext
    {
        public TechTrackersDbContext(DbContextOptions<TechTrackersDbContext> options) : base(options) { }
        public DbSet<Notification> Notifications { get; set; }
        public DbSet<User> Users { get; set; }
        public DbSet<Department> Departments { get; set; }
        public DbSet<Category> Categories { get; set; }
        public DbSet<SLA> SLAs { get; set; }
        public DbSet<Feedback> Feedbacks { get; set; }
        public DbSet<Escalation> Escalations { get; set; }
        public DbSet<Role> Roles { get; set; }
        public DbSet<Log> Logs { get; set; }
        public DbSet<LogChat> Log_chats { get; set; }
        public DbSet<LogStatusHistory> Log_status_history { get; set; }
        public DbSet<UserRole> User_Roles { get; set; }
        public DbSet<UserOtp> User_Otps { get; set; }
        public DbSet<Technician> Technicians { get; set; }  
        public DbSet<CollaborationRequests> CollaborationRequests { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            // configuring user to department relationship
            modelBuilder.Entity<User>()
                .HasOne(user => user.Department)
                .WithMany()
                .HasForeignKey(user => user.DepartmentId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<User>()
               .HasOne(u => u.Role) // Assuming a Role navigation property exists on User
               .WithMany()
               .HasForeignKey(u => u.RoleId)
               .OnDelete(DeleteBehavior.Restrict);
            //Log category
            modelBuilder.Entity<Log>()
                .HasOne(log => log.Category)
                .WithMany()
                .HasForeignKey(log => log.CategoryId)
                .OnDelete(DeleteBehavior.Restrict);

            /*modelBuilder.Entity<Log>()
                .HasOne(log => log.SLA)
                .WithOne(sla => sla.Log)
                .HasForeignKey<Log>(log => log.SLAId); // Foreign key is in Log, not SLA*/

            // Configure AssignedByUser relationship
            modelBuilder.Entity<Log>()
                .HasOne(log => log.AssignedByUser)
                .WithMany()
                .HasForeignKey(log => log.AssignedBy)
                .OnDelete(DeleteBehavior.Restrict); // Prevent cascade delete

            // Configure Technician relationship
            modelBuilder.Entity<Log>()
                .HasOne(log => log.Technician)
                .WithMany()
                .HasForeignKey(log => log.TechnicianId)
                .OnDelete(DeleteBehavior.Restrict);

            // Configure Staff relationship
            modelBuilder.Entity<Log>()
                .HasOne(log => log.Staff)
                .WithMany()
                .HasForeignKey(log => log.StaffId)
                .OnDelete(DeleteBehavior.Restrict);

            // Other configurations...

            base.OnModelCreating(modelBuilder);


        }
    }
}
